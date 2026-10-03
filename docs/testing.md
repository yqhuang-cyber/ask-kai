# Foundation verification and remaining acceptance

Run `npm ci --ignore-scripts`, `npm run verify` and `npm run replay` on Node
>=22.18. No provider credentials or network are required. CI runs Node 22 and 24.

Current tests cover runtime contract rejection, ready/failed/closed lifecycle,
duplicate and cross-session events, final-only attempted evidence with provenance,
wrong-turn and reused reply IDs, interruption with late audio/text/done/ack events,
fixture cancellation, loopback configuration, real-provider fail-closed behavior,
HTTP/SSE end-to-end projections, WebSocket rejection and cross-site/Host checks.
All fixtures contain authored synthetic text and audio metadata only.

## Traceability to the existing plan

| Plan task | Step 1 evidence | Remaining |
| --- | --- | --- |
| V01 | runnable shell, event validator, provider port, tests and CI | production framework and configuration after protocol verification |
| F02 | pinned HSKai source inventory | consent, region, schema and actual deployed integration |
| Q01 | foundation coverage mapped here | import original 58 case IDs and full requirements matrix |
| Q02 / V04 | deterministic late-event cancellation regression | real provider event fixtures and browser audio measurements |
| V03 / V05 | adapter placeholder and visible synthetic subtitles | real WSS/audio, provider text timing and phrase/audio alignment |
| A03 | attempted-only evidence invariant | prompted/independent use rules and persistent evidence |
| Q03 / Q04 | replay CLI entry point | actual multi-turn model execution, Langfuse Dataset, Judge and human calibration |

The replay CLI is an event regression tool. It does not evaluate teaching content,
does not call a model and does not report quality scores. Existing 10-dimensional
rubric, N/A weight handling and critical-failure gates remain the evaluation design.
They require the original dataset/case workbook to be archived and implemented.

## Manual local check

1. `npm start`; visit http://127.0.0.1:4310.
2. Run normal: synthetic subtitles increment and a single attempted evidence item appears.
3. Run interruption: cancelled subtitles clear; three late events are dropped; new reply survives old cancellation acknowledgment.
4. Run failure: the session stays failed; no provider connection is reported.
5. Stop midway, then restart; no previous subtitles remain.

Automated verification in this environment is Node/HTTP/SSE testing. Browser visual,
microphone, audio and real-provider validation are separate and must be reported
explicitly when performed. No real speech/AEC/latency claim follows from step 1.
