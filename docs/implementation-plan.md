# Incremental delivery

| Step | Deliverable | Gate | State |
| --- | --- | --- | --- |
| 1 | Local foundation, event contracts, synthetic replay, CI | Local verification passes; true provider readiness is never simulated | Merged to main (PR #1) |
| 2 | Actual Doubao protocol spike and adapter | Verified auth/audio/text/cancel/context behavior with redacted event samples | Started: preflight/probe and local WebSocket tests; full API and live account verification pending |
| 3 | Web presentation, browser capture/playback and real gateway | Continuous upload and stable real bidirectional speech | Implemented: AudioWorklet, PCM/playback, ticketed WebSocket, reviewed-profile adapter; real account/browser audio acceptance pending |
| 4 | Interruption, late-event isolation and subtitles | Real recordings/measurements confirm behavior across devices | Implemented: manual/provider speech-start cancellation, ACK timeout, reply fences and paced subtitles; real-device timing pending |
| 5 | One sports teaching loop | Goal, word card and evidence have traceable sources | Implemented: authored versioned goal/cards, persona, stages, sourced attempts, boundary context updates with ACK; real model teaching quality pending |
| 6 | HSKai authorization, three modes and minimal learner memory | Trusted course input, owner-scoped data and corrected preferences | Pending |
| 7 | Safety, privacy, content eval and controlled release | P0 regression, critical-failure gates, human handling and separate real-time metrics | Pending |

The first client is Web only. No iOS SDK or native app is required. The homepage
is a learner-facing layout preview with topic selection, prompts and an example
word card; it reports the unimplemented session endpoint honestly and does not
request microphone access. Engineering replay lives at /dev/replay. These UI
changes advance the presentation portion of step 3 without closing its audio gate.

Testing progresses alongside each step. Platform reuse is a separate spike: inspect
its source and prove one authorized teaching result before introducing a runtime
dependency. No migration to the platform is required to start the voice spike.
