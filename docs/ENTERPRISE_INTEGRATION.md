# Gemini Enterprise integration plan

Status: reserved adapter; no Enterprise execution has been verified.

`IncidentAnalyzer` and `AIAnalysisResult` separate provider-specific analysis from
policy and execution. `EnterpriseIncidentAnalyzer` currently returns labelled
`demo_fallback` with an explicit reason. Enabling its configuration does not connect it.

The Gemini API integration is separate. Each recorded analysis stores its actual
provider, model identifier and fallback reason. A configured key is not a verified
connection, and the interface labels that distinction.

## Prepare before access is issued

- Keep sanitized crash, degraded and ambiguous-evidence fixtures with expected
  review and runbook decisions.
- Prepare a knowledge pack containing the synthetic service, approved runbook,
  escalation rules and response schema.
- Preserve the deterministic policy engine and independent recovery verification.
- Plan execution references, provider identity, timestamps and failure provenance.
- Test invalid responses, authentication failure, timeout and fallback behaviour.

## Confirm before implementing transport

Confirm the required product, issued account/app, licence, region, allowed custom
connectors, invocation interface and required permissions with the organisers.
Do not guess an API endpoint or IAM role.

Google documents Workflow Builder, structured outputs, human review and custom MCP
connections. A small authenticated read-only incident tool is a candidate route,
subject to the issued environment; it is not currently implemented or approved.

- https://docs.cloud.google.com/gemini/enterprise/docs/workflow-builder
- https://docs.cloud.google.com/gemini/enterprise/docs/workflow-builder/workflows
- https://docs.cloud.google.com/gemini/enterprise/docs/workflow-builder/connect-mcp-servers

## Acceptance

Run both scenarios in the issued Enterprise environment and capture actual execution
references. Validate the returned schema and demonstrate that unknown/degraded
faults cannot bypass policy. Verify truthful error/fallback labels. Only claim an
Enterprise integration after this execution has been demonstrated.
