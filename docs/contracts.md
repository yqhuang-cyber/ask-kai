# Step 1 contracts

`packages/contracts/events.js` is the executable v1 schema. Unknown types/keys,
invalid identifiers, missing turn/response IDs, empty or oversized text and
oversized PCM metadata are rejected. This is an internal contract; no event name
here is a verified Doubao wire event.

| Type | Additional fields | Payload |
| --- | --- | --- |
| session.ready / session.closed | none | empty object |
| session.failed | none | code: safe error identifier |
| user.partial / user.final | turn_id | text: 1–2000 characters |
| response.started / response.done | turn_id, response_id | empty object |
| response.text.delta | turn_id, response_id | text: 1–2000 characters |
| response.audio.chunk | turn_id, response_id | byte_length: 1–65536; format: pcm_s16le |
| response.cancel.requested / response.cancelled | turn_id, response_id | empty object |

Audio events contain metadata only. Step 2 must define real binary frame envelopes,
codec/sample-rate negotiation, backpressure, context updates and tool proposals.

## Local diagnostic HTTP

- GET /: Web presentation preview; no microphone, playback or learner persistence.
- GET /dev/replay: separate engineering replay page.
- GET /healthz: synthetic_replay status; provider_connected always false.
- GET /api/replays: allowlisted scenario IDs and labels.
- GET /api/replays/:id: synthetic SSE `mode`, `accepted`, `dropped`, `summary`.
- POST /api/sessions: 501 REALTIME_NOT_IMPLEMENTED.
- WebSocket upgrades: 501; no real audio transport exists in step 1.

The above two fail-closed responses still apply to default startup. Reviewed
realtime configuration enables POST /api/sessions with authenticated launch
assertion and same origin, followed by a one-use /api/realtime upgrade. See
web-realtime.md and hskai-bridge.md for current contracts. Input is binary PCM;
output packets bind event/response identity and base64 PCM in one JSON envelope.
session.config does not assert readiness. session.ready is synthetic=false only
on the configured Doubao path. output.stop targets one reply; client controls
are session.end and response.cancel. Teaching/context/safety packets are explicit
separate types. No synthetic replay route activates microphone capture.

This SSE contract is diagnostic and is not the learner-facing UI protocol. A
synthetic session.ready event must never be interpreted as real connectivity.
Client disconnect stops the fixture generator. Reconnect starts a new replay;
there is no durable resume, business session or authentication in this shell.
