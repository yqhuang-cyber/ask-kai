# Incremental delivery

2026-10-12 收尾Task05-01已实现候选评测契约：显式绑定Agent提交、运行文件及允许变化，拒绝未声明变化和版本混用，提供独立候选工作流与同口径比较。旧基线保护保留，Agent运行文件／数据／依赖未改，本项没有真实模型调用。见[候选评测](candidate-evaluation.md)；下一项为05-02上下文快照。

2026-10-12 收尾 Task04设计已交付：[最小 POC Harness 改造方案](task04-poc-harness-design.md)及[Task05 分项实施与回归清单](task05-implementation-tasking.md)。明确本轮语言请求／会话设置／保存画像的作用范围、上下文快照与更新确认、拒绝／收束、澄清／纠正、共享预算、回合归属和总结证据。下一项为 05-01 候选版本评测契约，再逐类修改 Agent。本文档提交只更新设计、README及任务状态；46个运行文件、依赖、作者数据和旧评分均不变，没有新豆包或评分模型调用。Pi 完整目标设计继续归档参考。

2026-10-12 收尾 Task03完成本轮预注册根因对照：4主案、16新会话／40输入步骤均有效，直接复用 Task02音频。只中文请求均识别为关闭英文支架，但有2次仍带英文；上下文更新确认回执晚到时既有违规也有6个遵守反例，旧双语上下文干扰有支持，精确因果未完全隔离。040／036残段与Hmm超时本轮未复现，旧根因不冒充已修复。Agent、原基线与评分未改；其后 Task04设计已交付。见[结果](eval-results/2026-10-12-task03-root-cause.md)和[预注册范围](task03-root-cause-plan.md)。

2026-10-12 收尾 Task 02 已交付评测侧采集证据及独立真实诊断，未改 Agent：5 案／32 轮中 29 轮有效，011 完整，036 跨轮残段未复现，040 多 ASR 停止留证。失败片段计完整／进入评分的问题已修正；内部记忆与实际播放继续未覆盖。旧基线与 Task 01 分数保持原样，下一项是 Task 03 根因验证。见[Task 02 报告](eval-results/2026-10-12-task02-evidence.md)和[完整收尾 TODO](poc-completion-todo.md)。

## Evaluation before Agent changes (2026-10-11)

The user explicitly prioritizes evaluation tooling, collection and scoring before further Agent changes. Freeze the published Agent baseline `6661d7ba3ecf7f3eef8f23f74c5d625cb8f457e2`; retain the already merged ASR protocol repairs. Do not tune the Agent from one case. Tasks E01–E03 adapt actual observations to the existing rubric, complete evaluation evidence/review and enable controlled batch collection. E04 executes the full original set plus separately reported language controls; E05 aggregates evidence and root-cause hypotheses. Only then does H01 design Agent harness changes and compare versions. Current-turn strategy timing and content issues remain recorded, not repaired in this phase. Task 10 device acceptance remains separate. See [evaluation-first tasking](evaluation-first.md) and [baseline record](eval-baselines/freechat-v3.1-baseline.json).

2026-10-12 evaluation update: E01–E03 tooling is implemented; the full scope and two failed-case retries attempted all 48 cases. 47 cases collected completely; 244/255 actual replies were reviewed with the existing ten dimensions and per-criterion evidence. Case 011 retains five replies and eleven missing turns; eleven collected-turn criteria lack sufficient evidence. This is explicitly model-assisted offline review, with zero external Judge API calls and no human approval. E05 has an initial cross-case report, not confirmed causes. Agent runtime hashes remain frozen. See [results and proposed modification surfaces](eval-results/2026-10-12-freechat-baseline.md); H01 and Task 10 remain open.

## Independent POC scope (2026-10-09)

2026-10-12 closeout Task 01: reviewer-only calibration and comparison tooling are implemented. Reassessed 97 observed units; carried forward 147 v1 units on the identical immutable bundle. Failed turns changed from 36 to 20, material ASR differences from 42 to 8, with seven uncertain turns and nineteen unassessable criteria. This changes review interpretation, not Agent quality, runtime or rubric weights. Independent Judge calls and human approval remain zero/false. The user has separately confirmed ordinary Web vertical acceptance. See [calibration results](eval-results/2026-10-12-task01-calibration.md) and the [integrated closeout TODO](poc-completion-todo.md).

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
The language rule (Chinese first, short English support when needed)
is P0 within tasks 04, 06, 09 and 10. Task 04 implements the model policy and
metadata checks; Task 06 now implements approximate playback-aware captions.
Live model compliance and actual caption listening quality remain pending.
Both languages share the reply budget. The 2026-10-10 language adjustment adds only bounded support preferences, reported
comprehension and known expressions to P0; see [language support](language-support.md).
Full personas/complex bilingual or word-by-word glosses,
age-based duration, complete profiles/target
selection/scaffolding and correction branches are P1; cross-session continuity,
complex long-term memory and professional pronunciation evaluation are P2.
Existing authorization and safety invariants remain in force.

| Task | Deliverable | Status |
| --- | --- | --- |
| 01 | Current behavior inventory, opt-in metadata timeline/export, fixed cases | Engineering implemented; real-account/device baseline pending. See [experience baseline](experience-baseline.md) |
| 02 | Speech speed configuration and slow mode | Engineering implemented: slow default, normal option, session-isolated native speed and diagnostics. Real listening calibration pending. See [speech pace](speech-pace.md) |
| 03 | Turn-taking and false interruption fixes | Engineering implemented: ASR text confirmation, owner-bound output wait, serialized controls and duplicate/obsolete cancel handling. Real pause/echo/noise calibration pending. See [turn taking](turn-taking.md) |
| 04 | Short reply/density budgets; Chinese first, adaptive English support | Engineering implemented: versioned adaptive language/density policy, bounded sourced profile and current requests, shared budgets, ACK-safe audits and scoring criteria. Real model compliance/listening pending. See [short replies](short-replies.md) |
| 05 | Natural teaching decisions | Engineering implemented: single-goal/action selection, refusal/topic pause, clarification limit, teaching cooldown and sourced ACK snapshots. Real semantics/model teaching quality pending. See [natural teaching](natural-teaching.md) |
| 06 | Playback-aware progressive subtitles, preserving Chinese/English order | Engineering implemented: phrase buffering, PCM clock, pause/cancel fences, labeled text fallback and Web size/highlight controls. Real device synchronization pending. See [progressive captions](progressive-captions.md) |
| 07 | Per-session structured summary data | Engineering implemented: three entries, sourced target text/attempts, bounded refs, optional review and honest empty/partial/suppressed states. Bounded vocabulary and actual ASR/model semantics need acceptance. See [session summary](session-summary.md) |
| 08 | Web summary cards | Engineering implemented: Chinese-first headline, sourced expression/pinyin/English cards, attempt counts, one optional review, honest empty/partial/unavailable states and session/safety isolation. Real content/device acceptance pending. See [Web summary cards](web-summary-cards.md) |
| 09 | P0 regression and content evaluation, including language order and bilingual length | Engineering implemented: scoped runtime matrix, 16 cross-entry content cases, 10 authored negative controls, surface and per-criterion semantic gates, incomplete/review blocking, approved-record templates and optional structured Judge. Free-chat fixed-baseline observations and provisional model-assisted review completed for 244/255 turns; missing input coverage and human/independent Judge calibration remain open. See [evaluation results](eval-results/2026-10-12-freechat-baseline.md) and [P0 regression](p0-regression.md) |
| 10 | Real speech/device acceptance and fixes, including bilingual listening/captions | In progress: 2026-10-10 explicit audio-lane ownership, ID-less usage isolation and graceful adapter close repaired; 220 regression tests pass. Production-adapter live smoke passed complete TTS, two updates, cancellation, resumed output and graceful ACK; all 10 cancel-in-flight chunks discarded. ASR, model teaching and Web/device acceptance pending; Web review flags unchanged. See [Actions probe](protocol/actions-connect.md) |

Each development task is tested and committed separately on main. Engineering
implementation and real-experience acceptance are tracked separately. The
original steps below describe the foundation, not the current priority order.

## Foundation delivery

### Free-conversation evaluation data preparation

2026-10-10: completed the uploaded 40-case / 244-turn dataset preparation and checks. Opening soft goals, explicit unknown initial fields, sourced scenario assumptions, turn requirements and reference conflicts now follow adaptive language and existing Web-summary scope. The original ten-dimensional rubric is preserved. Reference replies and future turns cannot enter tested history; 34 proactive utterance signals are not idle events. A metadata-only manifest and offline preparation checker are on main; full dialogue files are delivered separately. Real response collection, runner adaptation and Judge scoring are the next task, not completed acceptance. See [dataset preparation](freechat-eval.md).

2026-10-11: calibrated the dataset as `freechat-v3.1-20261011` (prepared format v2). All 244 original turns now include independently authored language expectations, mapped scoring criteria, ten-dimensional anchors and short alternative replies. There are 33 concrete key-turn calibrations, 40 conditional case-specific summary contracts, and 8 supplementary language scenarios / 11 turns. Runtime language previews remain diagnostics, not gold labels. The offline checker accepts explicit authored-versus-runtime disagreements while rejecting future evidence, reference leakage and fabricated results. Actual reply collection, complete replay adaptation and real scoring remain pending; this iteration changes data preparation only.

2026-10-11: at the user's request, added the complete V3.1 Excel, JSON, CSV and review notes to the [versioned dataset directory](eval-datasets/freechat-v3.1/), with README links and per-file hashes in the manifest. CI now runs the offline checker against the committed JSON. This publishes the prepared fixed scripts and annotations; it does not record provider/Judge runs or complete real-experience acceptance.

### Multi-turn evaluation runner

2026-10-11: implemented the same-repository CLI `npm run eval:multiturn`. Default offline preflight selects one original case; explicit live collection uses the signed mock HSKai launch, production gateway/adapter, paced student audio, actual ASR/replies, teaching updates with ACK and existing summaries. Every case has a fresh session and declared initial language fixtures. References, soft goals and future turns never enter model requests. Optional fixed-input TTS uses the existing Doubao credential in separate sessions. Private, per-turn checkpoints bind candidate/data/audio/model/policy versions and preserve partial failures; later cases continue independently. Local protocol-fixture tests pass. No real run of this dataset has occurred, no scores are produced, and recorded-output adaptation, semantic review, scoring and Task 10 Web/device acceptance remain pending. See [runner usage and sequence](multiturn-eval.md).

2026-10-11: added a dedicated GitHub Actions first-case trial that reuses the existing `DOUBAO_API_KEY` Repository Secret. It pins case 001 / four turns and exact data/profile hashes, prepares authored input TTS, and collects through the same Agent runner with a five-minute supplier budget and no automatic retries. The existing probe-only attestation is explicit and remains rejected by ordinary Web/CLI; no normal review flags change. Three-day artifacts retain authored-input/AI observations and metadata, excluding PCM and raw provider wire traces. Local fixture checks validate isolation and blocked requests. The initial real trial is tracked separately from these engineering checks and from content/device acceptance.

2026-10-11 actual first-case trial: [run 38144369875](https://github.com/yqhuang-cyber/ask-kai/actions/runs/38144369875), candidate `8b3cf36bd57193cccf449eea7bb35e08343aae4c`, collected four ASR finals, four complete model replies, four context ACKs and a normal existing summary through the production Agent gateway using the existing Actions Secret. Earlier trial failures exposed and repaired the actual ASR final `text` mapping. Observed cumulative ASR revisions now replace partials; per-turn diagnostics include delayed context ACKs. Repair verification [run 38144953706](https://github.com/yqhuang-cyber/ask-kai/actions/runs/38144953706) also succeeded, with all per-turn ACKs retained and cumulative partials bounded. The current-turn decision ACK arrives after the response starts: next-turn confirmation does not prove current-turn policy application. That timing needs a separate design and live verification. Opening sentence budget, unsupported pronunciation praise and ASR surface differences require content review. No Judge scores, full-dataset acceptance or Web/device acceptance are claimed. See [actual trial notes](multiturn-eval.md#首案实际收集成功).

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
