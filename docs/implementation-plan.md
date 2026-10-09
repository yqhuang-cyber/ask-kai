# Incremental delivery

## Current P0: conversation experience (2026-10-09)

Only the reported speed, turn-taking, length/density, natural HSK association,
progressive subtitles and visual summary issues are P0 for the next iteration.
Full persona/bilingual formatting, age-based duration, complete profiles/target
selection/scaffolding and correction branches are P1; cross-session continuity,
complex long-term memory and professional pronunciation evaluation are P2.
Existing authorization and safety invariants remain in force.

| Task | Deliverable | Status |
| --- | --- | --- |
| 01 | Current behavior inventory, opt-in metadata timeline/export, fixed cases | Engineering implemented; real-account/device baseline pending. See [experience baseline](experience-baseline.md) |
| 02 | Speech speed configuration and slow mode | Pending |
| 03 | Turn-taking and false interruption fixes | Pending |
| 04 | Short reply and teaching-density budgets | Pending |
| 05 | Natural teaching decisions | Pending |
| 06 | Playback-aware progressive subtitles | Pending |
| 07 | Per-session structured summary data | Pending |
| 08 | Web summary cards | Pending |
| 09 | P0 regression and content evaluation | Pending |
| 10 | Real speech/device acceptance and fixes | Pending |

Each development task is tested and committed separately on main. Engineering
implementation and real-experience acceptance are tracked separately. The
original steps below describe the foundation, not the current priority order.

## Foundation delivery

| Step | Deliverable | Gate | State |
| --- | --- | --- | --- |
| 1 | Local foundation, event contracts, synthetic replay, CI | Local verification passes; true provider readiness is never simulated | Merged to main (PR #1) |
| 2 | Actual Doubao protocol spike and adapter | Verified auth/audio/text/cancel/context behavior with redacted event samples | Official PDF + Go/Python/Web Demo mapped; Seeduplex adapter and metadata mute/error probe implemented; 接入必读/ACK order/terminal IDs/live account verification pending |
| 3 | Web presentation, browser capture/playback and real gateway | Continuous upload and stable real bidirectional speech | Implemented: AudioWorklet, PCM/playback, ticketed WebSocket, reviewed-profile adapter; native Chromium synthetic-device checks pass; real account/device acceptance pending |
| 4 | Interruption, late-event isolation and subtitles | Real recordings/measurements confirm behavior across devices | Implemented: manual/provider speech-start cancellation, ACK timeout, reply fences and paced subtitles; real-device timing pending |
| 5 | One sports teaching loop | Goal, word card and evidence have traceable sources | Implemented: authored versioned goal/cards, persona, stages, sourced attempts, boundary context updates with ACK; real model teaching quality pending |
| 6 | HSKai authorization, three modes and minimal learner memory | Trusted course input, owner-scoped data and corrected preferences | Implemented: signed BFF bridge, scope/consent/market checks, trusted Mission, owner memory port/UI, correction/deletion/revocation; HSKai endpoint deployment pending |
| 7 | Safety, privacy, content eval and controlled release | P0 regression, critical-failure gates, human handling and separate real-time metrics | Implemented: safety floor/handoff and privacy ports, aggregate metrics, LangChain Judge, Langfuse scores, release checker and browser CI; live services/calibration/original P0/market approvals pending |

The first client is Web only. No iOS SDK or native app is required. The homepage
defaults to a disconnected preview. Real audio requires a reviewed supplier
profile, server credential and authenticated HSKai BFF contract. Test providers
have no UI activation switch. Engineering replay lives at /dev/replay. Steps
3–7 are code implementations with separate acceptance gates, not a released
student service. See release-and-eval.md and the release checker for open gates.

Testing progresses alongside each step. Platform reuse is a separate spike: inspect
its source and prove one authorized teaching result before introducing a runtime
dependency. No migration to the platform is required to start the voice spike.
