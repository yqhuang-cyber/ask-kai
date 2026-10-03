# Incremental delivery

| Step | Deliverable | Gate | State |
| --- | --- | --- | --- |
| 1 | Local foundation, event contracts, synthetic replay, CI | Local verification passes; true provider readiness is never simulated | Implemented in this branch |
| 2 | Actual Doubao protocol spike and adapter | Verified auth/audio/text/cancel/context behavior with redacted event samples | Next; needs approved server-side test credentials |
| 3 | Browser capture/playback and real gateway | Continuous upload and stable real bidirectional speech | Pending |
| 4 | Interruption, late-event isolation and subtitles | Real recordings/measurements confirm behavior across devices | Pending; only synthetic regression exists |
| 5 | One sports teaching loop | Goal, word card and evidence have traceable sources | Pending |
| 6 | HSKai authorization, three modes and minimal learner memory | Trusted course input, owner-scoped data and corrected preferences | Pending |
| 7 | Safety, privacy, content eval and controlled release | P0 regression, critical-failure gates, human handling and separate real-time metrics | Pending |

Testing progresses alongside each step. Platform reuse is a separate spike: inspect
its source and prove one authorized teaching result before introducing a runtime
dependency. No migration to the platform is required to start the voice spike.
