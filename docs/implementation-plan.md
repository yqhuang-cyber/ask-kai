# Incremental delivery

## Independent POC scope (2026-10-09)

The user clarified that this is an independent Ask Kai Agent POC. Default
business interfaces now use the repository's local mock HSKai HTTP service;
no `wohuipteltd/HSKai` checkout, BFF deployment or business database is needed.
The same ports, signed authorization and runtime ownership remain in use.
See [standalone POC](standalone-poc.md) and [ADR 0002](adr/0002-standalone-poc.md).
Tasks 05–10 use this backend; real voice still requires the local Doubao key
and a reviewed supplier profile. Mock safety/privacy records are not real
human delivery or vendor deletion evidence. This support task is separate
from Task 05, whose engineering rules are now implemented; real teaching quality
is still pending acceptance.

## Current P0: conversation experience (2026-10-09)

Only the reported speed, turn-taking, length/density, natural HSK association,
progressive subtitles and visual summary issues are P0 for the next iteration.
The basic language rule (short Chinese first, corresponding short English next)
is P0 within tasks 04, 06, 09 and 10. Task 04 implements the model policy and
metadata checks; Task 06 now implements approximate playback-aware captions.
Live model compliance and actual caption listening quality remain pending.
Both languages share the reply budget. Full personas/complex bilingual or word-by-word glosses,
age-based duration, complete profiles/target
selection/scaffolding and correction branches are P1; cross-session continuity,
complex long-term memory and professional pronunciation evaluation are P2.
Existing authorization and safety invariants remain in force.

| Task | Deliverable | Status |
| --- | --- | --- |
| 01 | Current behavior inventory, opt-in metadata timeline/export, fixed cases | Engineering implemented; real-account/device baseline pending. See [experience baseline](experience-baseline.md) |
| 02 | Speech speed configuration and slow mode | Engineering implemented: slow default, normal option, session-isolated native speed and diagnostics. Real listening calibration pending. See [speech pace](speech-pace.md) |
| 03 | Turn-taking and false interruption fixes | Engineering implemented: ASR text confirmation, owner-bound output wait, serialized controls and duplicate/obsolete cancel handling. Real pause/echo/noise calibration pending. See [turn taking](turn-taking.md) |
| 04 | Short reply and teaching-density budgets; Chinese first, corresponding English next | Engineering implemented: versioned bilingual/density policy, shared budgets, metadata audits and scoring criteria. Real model compliance/listening pending. See [short replies](short-replies.md) |
| 05 | Natural teaching decisions | Engineering implemented: single-goal/action selection, refusal/topic pause, clarification limit, teaching cooldown and sourced ACK snapshots. Real semantics/model teaching quality pending. See [natural teaching](natural-teaching.md) |
| 06 | Playback-aware progressive subtitles, preserving Chinese/English order | Engineering implemented: phrase buffering, PCM clock, pause/cancel fences, labeled text fallback and Web size/highlight controls. Real device synchronization pending. See [progressive captions](progressive-captions.md) |
| 07 | Per-session structured summary data | Engineering implemented: three entries, sourced target text/attempts, bounded refs, optional review and honest empty/partial/suppressed states. Bounded vocabulary and actual ASR/model semantics need acceptance. See [session summary](session-summary.md) |
| 08 | Web summary cards | Engineering implemented: Chinese-first headline, sourced expression/pinyin/English cards, attempt counts, one optional review, honest empty/partial/unavailable states and session/safety isolation. Real content/device acceptance pending. See [Web summary cards](web-summary-cards.md) |
| 09 | P0 regression and content evaluation, including language order and bilingual length | Engineering implemented: scoped runtime matrix, 16 cross-entry content cases, 10 authored negative controls, surface and per-criterion semantic gates, incomplete/review blocking, approved-record templates and optional structured Judge. Real observations/calibration still pending. See [P0 regression](p0-regression.md) |
| 10 | Real speech/device acceptance and fixes, including bilingual listening/captions | In progress: 2026-10-10 real Actions connection observed session readiness; fixed authored TTS/control probe next. ASR, model content, Web/device acceptance pending. See [Actions probe](protocol/actions-connect.md) |

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
| 6 | HSKai contract boundary, three modes and minimal learner memory | Signed course input, owner-scoped data and corrected preferences | Implemented: signed bridge, three modes and memory port/UI; standalone POC now includes local mock identity/Mission/preferences. External deployment is outside POC scope |
| 7 | Safety, privacy, content eval and controlled release | P0 regression, critical-failure gates, human handling and separate real-time metrics | Implemented: safety floor/handoff and privacy ports, aggregate metrics, LangChain Judge, Langfuse scores, release checker and browser CI; live services/calibration/original P0/market approvals pending |

The first client is Web only. No iOS SDK or native app is required. The homepage
defaults to a disconnected preview. Real audio requires a reviewed supplier
profile, server credential and signed identity from the local mock HSKai contract.
External HSKai integration is optional future work, not a POC prerequisite. Test providers
have no UI activation switch. Engineering replay lives at /dev/replay. Steps
3–7 are code implementations with separate acceptance gates, not a released
student service. See release-and-eval.md and the release checker for open gates.

Testing progresses alongside each step. Platform reuse is a separate spike: inspect
its source and prove one authorized teaching result before introducing a runtime
dependency. No migration to the platform is required to start the voice spike.
