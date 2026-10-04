# Implementation verification and remaining acceptance

Run `npm ci --ignore-scripts`, `npm run verify` and `npm run replay` on Node
>=22.18. No provider credentials or network are required. CI runs Node 22 and 24.

Current tests cover runtime contract rejection, ready/failed/closed lifecycle,
duplicate and cross-session events, final-only attempted evidence with provenance,
wrong-turn and reused reply IDs, interruption with late audio/text/done/ack events,
fixture cancellation, loopback configuration, real-provider fail-closed behavior,
HTTP/SSE end-to-end projections, WebSocket rejection and cross-site/Host checks.
All committed dialogue is authored/synthetic. WebSocket tests additionally contain
generated PCM bytes; browser checks use a Chromium synthetic microphone device.

Protocol-probe tests additionally cover profile/credential preflight, real Node
WebSocket headers against a loopback peer, historical readiness versus active
connection state, payload-value masking, within-run identity aliases, malformed
frames, aborts and bounded report output. See docs/protocol/duplex-spike.md.

## Traceability to the existing plan

| Plan task | Step 1 evidence | Remaining |
| --- | --- | --- |
| V01 | runnable shell, event validator, provider port, tests and CI | production framework and configuration after protocol verification |
| F02 | pinned HSKai source inventory | consent, region, schema and actual deployed integration |
| Q01 | foundation coverage mapped here | import original 58 case IDs and full requirements matrix |
| Q02 / V04 | deterministic late-event cancellation regression | real provider event fixtures and browser audio measurements |
| V03 / V05 | reviewed-profile adapter, real local WebSocket/PCM, progressive reply-fenced captions, native browser API checks | actual account WSS/audio, provider timing and phrase/audio alignment |
| A03 | attempted-only evidence invariant | prompted/independent use rules and persistent evidence |
| Q03 / Q04 | separate scorer, LangChain structured Judge, numeric Langfuse export port, NA/critical/release rules | real-model runs, original cases, deployed Dataset/score readback and human calibration |

The replay CLI is an event regression tool. It does not evaluate teaching content,
does not call a model and does not report quality scores. The separate content
runner implements the 10-dimensional scoring contract. Its eight seed examples
are illustrative scoring data, not actual teacher performance or the original
58-case workbook/53 P0 cases. Those original IDs still need archival and mapping.

## Manual local check

1. `npm start`; visit http://127.0.0.1:4310. Switch sports/free topics and check prompts update. Mission stays disabled.
2. Start conversation: service returns 501, page reports realtime unavailable and remains disconnected; no microphone permission is requested.
3. Open /dev/replay and run normal: synthetic subtitles increment and a single attempted evidence item appears.
4. Run interruption: cancelled subtitles clear; three late events are dropped; new reply survives old cancellation acknowledgment.
5. Run failure: the session stays failed; no provider connection is reported.
6. Stop midway, then restart; no previous subtitles remain.

Local verification now includes Node rules, HTTP/SSE, real loopback WebSocket,
PCM/ownership/cancellation/context, auth/Mission/memory/privacy, safety/tool rules,
LangChain callable Judge and Langfuse HTTP contract tests, plus native Chromium.
Browser controls and synthetic-device AudioWorklet capture/playback pass, including
continuous capture during stop and no permission request while disconnected.
Local CJK fonts were absent, so typography needs a font-capable device check.
No real-provider, live Judge/Langfuse, deployed HSKai, human-team or actual AEC/
audible-latency acceptance was performed. Release status remains blocked.
# Seeduplex protocol follow-up

`tests/seeduplex.test.js` uses authored synthetic payloads shaped by the supplied
official PDF and Go/Python/Web demos. It covers text-before-audio, ASR increment
assembly, attempted-only final evidence, output format/framing, text suffixes,
audio-vs-interaction completion, cancellation with a newer reply, serialized and
deduplicated ACKs, wrong ownership and masked failures. A local gateway/WebSocket
integration exercises teaching context updates. Additional probe and interruption
regressions verify mute/close/error behavior and waiting for cancellation before
updating context. No real provider transcript/audio, key or live assertion is used.
See `protocol/seeduplex-integration.md` for ACK and terminal-identity limitations.
