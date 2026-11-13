import asyncio
import re
import json
import logging
import time
from collections import deque
from services.api.investigation import (
    PROMPT_VERSION,
    PURPOSE,
    SYSTEM_PROMPT,
    timestamp,
    tool_declarations,
    run_diagnostic,
    evidence_context,
)
from abc import ABC, abstractmethod
from contextlib import suppress
from typing import Optional, List, Dict, Any
from services.api.config import settings
from services.api.schemas import AIAnalysisResult
from services.demo_scenarios import SCENARIOS

logger = logging.getLogger("rebound.analyzer")


def sanitize_logs(text: str) -> str:
    """Sanitize and redact sensitive data like passwords, tokens, API keys, and email addresses."""
    if not text:
        return ""
    # Redact potential authorization tokens and secrets
    text = re.sub(
        r"(bearer\s+)[a-zA-Z0-9_\-\.]+",
        r"\1[REDACTED_TOKEN]",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"([a-zA-Z0-9_\-\.]*token[a-zA-Z0-9_\-\.]*\s*[:=]\s*)[^\s,]+",
        r"\1[REDACTED]",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"([a-zA-Z0-9_\-\.]*password[a-zA-Z0-9_\-\.]*\s*[:=]\s*)[^\s,]+",
        r"\1[REDACTED]",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"([a-zA-Z0-9_\-\.]*secret[a-zA-Z0-9_\-\.]*\s*[:=]\s*)[^\s,]+",
        r"\1[REDACTED]",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"[\w\.-]+@[\w\.-]+\.\w+", "[REDACTED_EMAIL]", text)
    text = re.sub(r"(?i)(api[_-]?key\s*[:=]\s*)[^\s,]+", r"\1[REDACTED]", text)
    return text


class IncidentAnalyzer(ABC):
    @abstractmethod
    async def analyze(
        self,
        incident_id: str,
        service_name: str,
        recent_probes: List[Dict[str, Any]],
        last_error: Optional[str] = None,
    ) -> AIAnalysisResult:
        pass


class DeterministicDemoAnalyzer(IncidentAnalyzer):
    """
    Clearly labelled deterministic local fallback analyzer.
    Used for keyless testing or when credentials are not supplied.
    UI prominently badges this as Demo Fallback Mode.
    """

    async def analyze(
        self,
        incident_id: str,
        service_name: str,
        recent_probes: List[Dict[str, Any]],
        last_error: Optional[str] = None,
    ) -> AIAnalysisResult:
        err = (last_error or "").lower()
        evidence_ids = [str(p.get("id")) for p in recent_probes if p.get("id")]

        for scenario_id in SCENARIOS:
            if scenario_id in ("crash", "degraded"):
                continue
            scenario = SCENARIOS[scenario_id]
            if scenario["error_code"].lower() in err:
                return AIAnalysisResult(
                    incident_id=incident_id,
                    provider="demo_fallback",
                    summary=f"{service_name}: {scenario['title']}",
                    suspected_cause=f"Observed demo fault: {scenario['error_code']}",
                    evidence_event_ids=evidence_ids,
                    confidence="medium",
                    recommended_runbook_id=scenario["runbook_id"],
                    reasoning_summary=scenario["outcome"],
                    requires_human_review=scenario["runbook_id"] is None,
                )

        if "degraded" in err or "500" in err or "pool" in err or "deadlock" in err:
            return AIAnalysisResult(
                incident_id=incident_id,
                provider="demo_fallback",
                summary=f"{service_name} is degraded and returning HTTP 500 error responses",
                suspected_cause=(
                    "Possible connection pool fault"
                    if "pool" in err or "deadlock" in err
                    else "Application fault; root cause unconfirmed"
                ),
                evidence_event_ids=evidence_ids,
                confidence="medium",
                recommended_runbook_id=None,
                reasoning_summary="Application failure evidence requires human investigation. No automated recovery runbook is authorised for this fault.",
                requires_human_review=True,
            )

        if not any(
            marker in err for marker in ("connection refused", "timed out", "timeout")
        ):
            return AIAnalysisResult(
                incident_id=incident_id,
                provider="demo_fallback",
                summary=f"{service_name} has an unconfirmed fault",
                suspected_cause="Insufficient evidence to determine the cause",
                evidence_event_ids=evidence_ids,
                confidence="low",
                recommended_runbook_id=None,
                reasoning_summary="Review the recorded probes before choosing a recovery action.",
                requires_human_review=True,
            )
        return AIAnalysisResult(
            incident_id=incident_id,
            provider="demo_fallback",
            summary=f"{service_name} health endpoint is completely unreachable",
            suspected_cause="The demo process may have stopped or its connection timed out",
            evidence_event_ids=evidence_ids,
            confidence="medium",
            recommended_runbook_id="RESTART_DEMO_CHILD_SERVICE",
            reasoning_summary="Connection failure evidence makes the demo restart eligible for policy evaluation. Recovery still requires independent health verification.",
            requires_human_review=False,
        )


def assessment_schema():
    schema = AIAnalysisResult.model_json_schema()
    schema["properties"].pop("investigation", None)
    return schema


class GeminiIncidentAnalyzer(IncidentAnalyzer):
    # ponytail: process-local quota, supported deployment uses one monitor worker.
    _active = False
    _starts = deque()
    _blocked_until = 0.0

    def __init__(self, api_key: str, model_id: str = "gemini-3.5-flash-lite"):
        self.api_key = api_key
        self.model_id = model_id
        self.fallback = DeterministicDemoAnalyzer()

    async def analyze(self, incident_id, service_name, recent_probes, last_error=None):
        trace = {
            "prompt_version": PROMPT_VERSION,
            "purpose": PURPOSE,
            "model": self.model_id,
            "started_at": timestamp(),
            "completed_at": None,
            "model_available": False,
            "steps": [],
            "token_count": 0,
            "limitation": None,
        }

        async def fallback(reason, review=False):
            result = await self.fallback.analyze(
                incident_id, service_name, recent_probes, last_error
            )
            result.fallback_reason = reason
            if review:
                result.recommended_runbook_id = None
                result.requires_human_review = True
                result.confidence = "low"
            trace["limitation"] = reason
            trace["completed_at"] = timestamp()
            result.investigation = trace
            return result

        if not self.api_key:
            return await fallback("No Gemini API key configured.")
        now = time.monotonic()
        cls = type(self)
        while cls._starts and cls._starts[0] <= now - 60:
            cls._starts.popleft()
        if cls._active or len(cls._starts) >= 3 or now < cls._blocked_until:
            return await fallback(
                "Gemini request guard busy or quota cooling down; deterministic fallback used."
            )
        cls._active = True
        cls._starts.append(now)
        client = None
        phase = "model_availability"
        try:
            async with asyncio.timeout(settings.ANALYSIS_TIMEOUT_SECONDS * 0.9):
                from google import genai
                from google.genai import types

                client = genai.Client(
                    api_key=self.api_key,
                    http_options=types.HttpOptions(
                        timeout=int(settings.ANALYSIS_TIMEOUT_SECONDS * 900),
                        retry_options=types.HttpRetryOptions(attempts=1),
                    ),
                )
                # Verify the configured model rather than assuming a particular default exists.
                await client.aio.models.get(model=self.model_id)
                trace["model_available"] = True
                clean = [
                    {
                        "id": str(p["id"]) if p.get("id") else None,
                        "http_status": p.get("http_status"),
                        "success": p.get("success"),
                        "latency_ms": p.get("latency_ms"),
                        "details": sanitize_logs(str(p.get("sanitized_details", "")))[
                            :300
                        ],
                    }
                    for p in recent_probes[:5]
                ]
                context = evidence_context(
                    incident_id,
                    sanitize_logs(service_name)[:150],
                    clean,
                    sanitize_logs(last_error or "")[:600],
                )
                trace["evidence_ids"] = [p["id"] for p in clean if p["id"]]
                trace["steps"].append(
                    {
                        "event_type": "GEMINI_INVESTIGATION_STARTED",
                        "at": timestamp(),
                        "summary": "Gemini model availability verified; read-only investigation requested.",
                    }
                )
                contents = [
                    types.Content(role="user", parts=[types.Part(text=context)])
                ]
                known = set(trace["evidence_ids"])
                for round_number in range(2):
                    phase = f"diagnostic_round_{round_number + 1}"
                    response = await client.aio.models.generate_content(
                        model=self.model_id,
                        contents=contents,
                        config=types.GenerateContentConfig(
                            system_instruction=SYSTEM_PROMPT,
                            tools=[
                                types.Tool(function_declarations=tool_declarations())
                            ],
                            automatic_function_calling=types.AutomaticFunctionCallingConfig(
                                disable=True
                            ),
                            max_output_tokens=512,
                            temperature=0.1,
                        ),
                    )
                    trace["token_count"] += (
                        getattr(
                            getattr(response, "usage_metadata", None),
                            "total_token_count",
                            0,
                        )
                        or 0
                    )
                    if trace["token_count"] > 12000:
                        raise ValueError("Investigation token budget exceeded")
                    calls = getattr(response, "function_calls", None) or []
                    if not calls:
                        candidates = getattr(response, "candidates", None)
                        if candidates and candidates[0].content:
                            contents.append(candidates[0].content)
                        break
                    if len(calls) > 2:
                        raise ValueError("Too many diagnostic requests")
                    contents.append(response.candidates[0].content)
                    parts = []
                    for call in calls:
                        # Validation precedes recording or executing any model-supplied arguments.
                        from services.api.investigation import DiagnosticArguments

                        args = DiagnosticArguments.model_validate(
                            call.args
                        ).model_dump()
                        if args["incident_id"] != incident_id or call.name not in {
                            d["name"] for d in tool_declarations()
                        }:
                            raise ValueError("Unauthorized diagnostic request")
                        trace["steps"].append(
                            {
                                "event_type": "DIAGNOSTIC_TOOL_REQUESTED",
                                "at": timestamp(),
                                "tool": call.name,
                                "arguments": args,
                                "round": round_number + 1,
                                "summary": f"Requested read-only {call.name}.",
                            }
                        )
                        output = await asyncio.wait_for(
                            run_diagnostic(call.name, args, incident_id, clean),
                            timeout=2,
                        )
                        known.update(output["evidence_ids"])
                        trace["steps"].append(
                            {
                                "event_type": "DIAGNOSTIC_TOOL_COMPLETED",
                                "at": timestamp(),
                                "tool": call.name,
                                "evidence_ids": output["evidence_ids"],
                                "result": output,
                                "summary": f"Read-only {call.name} returned {len(output['evidence_ids'])} evidence references.",
                            }
                        )
                        parts.append(
                            types.Part(
                                function_response=types.FunctionResponse(
                                    name=call.name,
                                    id=getattr(call, "id", None),
                                    response=output,
                                )
                            )
                        )
                    contents.append(types.Content(role="user", parts=parts))
                contents.append(
                    types.Content(
                        role="user",
                        parts=[
                            types.Part(
                                text="Diagnostic rounds finished. Return the final grounded structured assessment now. No more tools."
                            )
                        ],
                    )
                )
                phase = "structured_assessment"
                response = await client.aio.models.generate_content(
                    model=self.model_id,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        response_mime_type="application/json",
                        response_schema=assessment_schema(),
                        max_output_tokens=1536,
                        temperature=0.1,
                    ),
                )
                trace["token_count"] += (
                    getattr(
                        getattr(response, "usage_metadata", None),
                        "total_token_count",
                        0,
                    )
                    or 0
                )
                if trace["token_count"] > 12000:
                    raise ValueError("Investigation token budget exceeded")
                parsed = json.loads(response.text)
                parsed.update(
                    incident_id=incident_id,
                    provider="gemini_api",
                    investigation=None,
                    fallback_reason=None,
                )
                result = AIAnalysisResult(**parsed)
                if not set(result.evidence_event_ids).issubset(known):
                    raise ValueError("Fabricated evidence reference")
                if result.recommended_runbook_id not in {
                    None,
                    "RESTART_DEMO_CHILD_SERVICE",
                    "REPLAY_DEMO_ATTENDANCE_QUEUE",
                }:
                    raise ValueError("Unknown recovery recommendation")
                if result.recommended_runbook_id and not result.evidence_event_ids:
                    raise ValueError("Ungrounded recovery recommendation")
                from services.api.policy import evidence_allows_runbook

                if result.recommended_runbook_id and not evidence_allows_runbook(
                    result.recommended_runbook_id, last_error
                ):
                    raise ValueError(
                        "Recommendation contradicts recorded failure evidence"
                    )
                # A successful latest probe contradicts a current failure, not an older healthy baseline.
                if clean and clean[0]["success"] is True:
                    result.recommended_runbook_id = None
                    result.requires_human_review = True
                    trace["limitation"] = (
                        "Latest probe contradicts the incident failure; human review required."
                    )
                # Sanitize model-authored public text too; do not trust it as an output boundary.
                for field in ("summary", "suspected_cause", "reasoning_summary"):
                    setattr(result, field, sanitize_logs(getattr(result, field))[:1000])
                trace["completed_at"] = timestamp()
                result.investigation = trace
                return result
        except Exception as error:
            name = type(error).__name__
            status = getattr(error, "code", None)
            if isinstance(status, int):
                trace["failure_status"] = status
                trace["failure_stage"] = phase
            if status == 429:
                cls._blocked_until = time.monotonic() + 60
            logger.warning(
                "Gemini investigation unavailable (%s); using labelled fallback", name
            )
            reason = (
                "Gemini quota exhausted or rate limited; deterministic fallback used."
                if status == 429
                else f"Gemini investigation unavailable ({name}{f'; HTTP {status} during {phase}' if isinstance(status, int) else ''}); deterministic fallback used."
            )
            return await fallback(
                reason,
                review=isinstance(error, ValueError),
            )
        finally:
            cls._active = False
            if client is not None:
                with suppress(Exception):
                    await client.aio.aclose()
                with suppress(Exception):
                    client.close()


class EnterpriseIncidentAnalyzer(IncidentAnalyzer):
    """Reserved adapter. It returns labelled fallback until a real transport is implemented."""

    def __init__(self, endpoint: str):
        self.endpoint = endpoint
        self.fallback = DeterministicDemoAnalyzer()

    async def analyze(
        self,
        incident_id: str,
        service_name: str,
        recent_probes: List[Dict[str, Any]],
        last_error: Optional[str] = None,
    ) -> AIAnalysisResult:
        result = await self.fallback.analyze(
            incident_id, service_name, recent_probes, last_error
        )
        result.fallback_reason = "Gemini Enterprise transport is not implemented."
        return result


def get_analyzer() -> IncidentAnalyzer:
    if (
        settings.GEMINI_ENTERPRISE_ENABLED
        and settings.GEMINI_ENTERPRISE_WORKFLOW_ENDPOINT
    ):
        return EnterpriseIncidentAnalyzer(settings.GEMINI_ENTERPRISE_WORKFLOW_ENDPOINT)
    if settings.GEMINI_API_KEY:
        return GeminiIncidentAnalyzer(settings.GEMINI_API_KEY, settings.GEMINI_MODEL)
    return DeterministicDemoAnalyzer()
