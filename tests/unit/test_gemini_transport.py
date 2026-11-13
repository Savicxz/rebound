"""Real SDK serialization over mocked HTTP; never live-provider verification."""

import json
import httpx
import pytest
from google import genai
from services.api.analyzer import GeminiIncidentAnalyzer


@pytest.mark.asyncio
async def test_manual_tool_response_preserves_call_id_and_supported_role(monkeypatch):
    real_client = genai.Client
    requests = []

    def handle(request):
        if request.method == "GET":
            return httpx.Response(200, json={"name": "models/transport-test"})
        body = json.loads(request.content)
        requests.append(body)
        if len(requests) == 1:
            parts = [
                {
                    "functionCall": {
                        "id": "call-1",
                        "name": "get_recent_health_probes",
                        "args": {"incident_id": "transport-incident"},
                    },
                    "thoughtSignature": "c2lnbmF0dXJl",
                }
            ]
        else:
            model_turn = body["contents"][1]
            response_turn = body["contents"][2]
            assert model_turn["parts"][0]["thoughtSignature"] == "c2lnbmF0dXJl"
            assert response_turn["role"] == "user"
            response = response_turn["parts"][0]["functionResponse"]
            assert response["id"] == "call-1"
            assert response["response"]["evidence_ids"] == ["probe-1"]
            if len(requests) == 2:
                parts = [{"text": "Evidence sufficient."}]
            else:
                assert "tools" not in body
                parts = [
                    {
                        "text": json.dumps(
                            {
                                "incident_id": "transport-incident",
                                "provider": "gemini_api",
                                "summary": "Recorded connection failure",
                                "suspected_cause": "Unavailable process",
                                "evidence_event_ids": ["probe-1"],
                                "confidence": "medium",
                                "recommended_runbook_id": "RESTART_DEMO_CHILD_SERVICE",
                                "reasoning_summary": "Connection failure recorded",
                                "requires_human_review": False,
                            }
                        )
                    }
                ]
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {"role": "model", "parts": parts},
                        "finishReason": "STOP",
                    }
                ],
                "usageMetadata": {"totalTokenCount": 50},
            },
        )

    def client(**kwargs):
        options = kwargs["http_options"]
        options.client_args = {"transport": httpx.MockTransport(handle)}
        options.async_client_args = {"transport": httpx.MockTransport(handle)}
        return real_client(**kwargs)

    monkeypatch.setattr(genai, "Client", client)
    GeminiIncidentAnalyzer._active = False
    GeminiIncidentAnalyzer._starts.clear()
    GeminiIncidentAnalyzer._blocked_until = 0
    result = await GeminiIncidentAnalyzer("test-placeholder", "transport-test").analyze(
        "transport-incident",
        "Synthetic",
        [{"id": "probe-1", "success": False}],
        "Connection refused",
    )
    assert result.provider == "gemini_api"
    assert len(requests) == 3
    assert (
        result.investigation["steps"][-1]["event_type"] == "DIAGNOSTIC_TOOL_COMPLETED"
    )
