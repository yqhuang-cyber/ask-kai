# 主题式对话入口：实现与验收

2026-10-15。实现范围是独立 Web POC 的主题式对话。身份、三类学习者资料、课程记录仍由授权的本地 Mock HSKai 端口提供；共享 Topic Pack 不包含学习者资料。Mission 保留原入口契约；free 的依赖隔离修复见下文。豆包仍使用已审核的实时语音 profile，逐轮决策仍为 `next_turn_advisory`。

主题持续规划现已补充独立主题状态、逐轮关系判断、换题来源约束、暂停后保留主题、偏好覆盖修复和 Web 待切换状态。行为、合成检查及语义／执行限制见[主题连续性](topic-continuity.md)；没有新增同步模型调用或当轮生成门控。

## 主题目标准备与展示

2026-10-15 用户最新决定取代早先的“主题可无目标”：主题初始化必须选择一个合法教学目标。`kai-initial-teaching-v2` 固定 `plan_kind:targeted_practice`、`no_goal_reason:null`，目标关联的 `key_points` 必须与资源一致，`teaching_decision.task` 必须非空，明确本次表达任务。这里的知识点是已发布主题包关联的交流能力条目；没有扩展为完整 HSK 语法／词汇教学资源，也没有新增未经准入的语言例句。

- LLM 空目标或不完整提案在同一初始化期限内最多修复一次；仍无有效提案时使用经过同样校验的规则计划。
- 规则优先使用有来源的支持／复习需要；未命中需要时，从合法候选中按先修数量、目标 ID 排序，选择探索性表达或新情境应用目标。后者只说明安排的任务，不断定学生有薄弱点，也不把旧内容重新判为未掌握。
- 当前明确拒绝练习返回 `TOPIC_PRACTICE_DECLINED`；明确请求但先修不满足返回 `TOPIC_REQUESTED_GOAL_UNAVAILABLE`；全部候选被拒绝或先修不满足返回 `TOPIC_NO_ELIGIBLE_GOAL`。准备状态为 failed，不返回 view、不允许消费创建会话，Web 提示调整主题／意愿或选择自由聊天。
- Free 仍不读取 Topic Pack，初始目标、知识点和任务为空。会中学生仍可暂停、停止或换目标；初始化有目标不构成强制跟读或必须完成练习。

`planProjection()` 输出 `goal_details:{goal_id,status,key_points:[{id,label}],expression_task}`；无目标时为 null。知识点名称来自同一固定版本资源，任务来自已接受计划；页面不自行生成。准备成功后显示目标、知识点、表达任务，切换学习者／主题／入口、重新准备或失败会清空旧内容。初次与后续语音上下文携带同一 details；同一目标暂停／恢复保留个性化任务，替换目标时重取对应知识点和任务。此变更沿用 `next_turn_advisory`，不能证明当轮语音按外部规划生成。

原 28 案设计输入／oracle／hash 均保留；其中原无教学／无合法候选案例在当前产品规则下改为准备失败。契约测试只核对新规则，未把原集合重新标成语义评测通过。本轮 `npm run verify` **463/463**、三个 synthetic replay 通过；Chromium 主题专项检查覆盖两个主题、四位合成学习者、目标／知识点／任务展示、跨主题清理、拒绝导致准备失败、free 无目标与撤销刷新，页面错误及移动端横向溢出均为 0。注入规划器覆盖空目标修复和规则回退；这些属于合成工程检查，未调用真实规划模型或豆包，也未做真人麦克风／听感检查。

## 工程 review 第 1 项：free 入口隔离

移除 Gateway 中 free 显式练习时读取 `topic:sports` 的 resolver。free 准备、消费及逐轮输入始终 `resource:null`，不需要 Topic Manager 或课程读取权限；三类授权学习者资料与实际对话仍进入通用 Planner。初始化无目标、单次求助仅限本轮，明确持续练习才从宿主通用 Skill catalog 选技能并验证先修。计划使用独立 `skill_catalog_ref`／GoalInstance `catalog_ref`，课程 `resource_refs` 为空，页面无运动词卡。通用技能当前均为 unassessed；旧运动尝试标记也不会作用于 free。shadow ObservationPort 可提出未校准候选，但不产生学习事实或保存的 attempted。

本次验证：`npm run verify` **461/461**；`npm run replay` 三个 synthetic 场景通过；原 Chromium 合成设备检查和 Topic Manager／学习页检查通过，页面错误均为 0。新增 free 边界测试检查 Topic Manager 离线、零课程调用、三类资料与实际前文、非运动技能、局部求助到期、明确拒绝、先修及虚构目标／尝试拒绝；网关测试覆盖页面／后续语音上下文一致和 mock 保存回执。44 轮长会话使用[版本化 v2 断言](eval-datasets/agent-long-session-v2/README.md)，v1 原数据保留。

历史 `dynamic-goals-v1` 的 18 轮规则评测为 17/18：唯一差异是 free 的 `prerequisite` 案仍要求“表达时间”沿用运动课程的“表达喜好”先修。通用 catalog 不声明这一先修，因此当前显式选择可以生效；原案例及期望未改，也未据此宣称该历史集合全部通过。通用技能的先修拒绝已用“支持观点需要说明原因”单独验证。本次未调用真实 M3／豆包，也未进行真人麦克风或听感验收；下方真实结果属于之前的主题链路验证。其余 review 项未在本次实施。

## 使用链路

1. 独立 `apps/topic-manager` 定义 `topic_id`、名称和 brief，在后台排队生成草稿。`npm run topics` 使用本机已配置的 MiniMax M3；`npm run topics:synthetic` 只生成明确标记的工程测试包。Generator 只能从通用通信能力目录选择 skill，并生成主题情境和开场；skill、先修、证据规则由宿主定义，词卡／语言例句目前不准入。
2. 草稿经过结构校验、安全字段筛查和辅助内容审阅，成为 `validated_restricted` 版本。管理端显式发布后才进入只读目录。不可用版本可撤销，旧已发布版本可再次发布作为回滚。版本、来源、prompt 与输入 hash 存在 `.local/topic-manager`；写入采用原子 manifest 和进程锁。
3. 学习端 `GET /api/topics` 只展示已发布主题。准备阶段通过只读服务读取固定版本，并由三类授权 learner data 推导需要假设。Planner 必须选择一个合法 GoalInstance 并提供知识点和表达任务，否则准备失败。准备与一次性消费检查相同学习者、资料 revision、pack version/hash；服务离线、未发布或撤销时失败关闭。Gateway 对包内容使用 hash/ETag 缓存，但每次命中仍由主题服务确认版本处于 published；撤销、服务离线都不能复用旧缓存。在线读路径没有 Generator 调用。
4. 页面预览、初次实时语音上下文和后续教学状态使用同一 plan 与 pack。当前学生选择、拒绝、困难、换题及原有防迟到／话轮归属规则继续生效；读取到撤销状态的会话在下一次规划前停止旧目标。新 topic skill 的观察规则为 `unassessed`，不会记录为表达尝试或掌握。
5. 每个已接受的 final 从 TeachingSession 接收时开始共用最多 2 秒规划期限，资源确认、LLM／修复、验证和提交共享期限，并预留 200ms；超时使用有来源的规则回退。此期限不等于首音或教师实际遵循率。

## 服务和权限

两个本机进程分别运行：`npm run topics` 与 `npm run poc`。默认管理页为 <http://127.0.0.1:4320>，学习页为 <http://127.0.0.1:4310>。`TOPIC_MANAGER_STORE` 默认 `.local/topic-manager`，目录忽略于 Git；首次启动自动生成管理／只读两个凭据，保存在仅本机可读的 `credentials.json`。管理页由使用者在本机输入管理凭据；Gateway 只读取服务凭据并转交已发布列表，不提供发布或生成入口。环境变量显式覆盖时须同时配置 `TOPIC_MANAGER_ADMIN_TOKEN` 与 `TOPIC_MANAGER_READ_TOKEN`。更换文本供应商须注册独立 transport/profile；生成、审阅、Planner 角色可各自配置，不在业务契约里硬编码模型身份。

管理 API：`POST /api/admin/topics`、`POST /api/admin/generate`、`GET /api/admin`、`POST /api/admin/cancel`、`POST /api/admin/publish`、`POST /api/admin/revoke`。只读 API：`GET /api/published` 与 `GET /api/published/:id?version=...`。均只监听 loopback，写操作检查 Origin，读写凭据分离。生成任务由 request_id 幂等，状态包含排队、生成、校验、成功、失败与取消；重启将未完成任务标为失败，不自动重复收费调用。后台生成预算最多 60 秒，不占学习者的 10 秒准备或 2 秒逐轮期限。

## 验证范围

`npm run verify`、`npm run replay`、`npm run test:browser`、`npm run test:browser:topics` 与 `npm run eval:topics` 分别检查运行契约、三个 synthetic replay、原浏览器回归、新管理／学习页回归及合成资料评测。原 28 个初始化设计案例的文件和 hash 未改；harness 物化全部 28 案，主题入口中的 24 案走当前决策契约，4 个 Mission／free 案保留在各入口后续实施范围。最新四个 mock learner 集成测试使用同一个固定 pack，对照资源顺序、姓名与等级变化，并检查版本固定、撤销、无目标和第二主题。

`npm run eval:topics -- --live --publish` 显式使用配置的真实文本模型，输出仅为元数据的本机报告 `.local/topic-eval/real-report.json`。生成报告区分 succeeded／failed，初始化和逐轮区分 `llm`／`rule`、降级原因及实际耗时；设计案例的语义状态始终是 `review_required`，不能把合同字段接受算成教学质量通过。自动内容审阅即使用不同模型，也不是人工校准。浏览器检查使用 synthetic provider；真实豆包、物理麦克风、真实首音／听感及 controlled 的验收仍独立开放。

## 当前结果与后续

工程回归：完整 `npm run verify` 456/456、三个 synthetic replay、原 Chromium 合成设备浏览器检查和新增主题专项浏览器检查已通过；新浏览器专项覆盖两个主题、四位学习者、明确无目标、撤销刷新和运行时零生成调用。合成 `npm run eval:topics` 生成 2/2，固定包下 8/8 初始化与 8/8 逐轮合同通过且为 rule；原设计 28 案的 hash 均通过，主题范围 24 案合同通过，另外 4 案属于 Mission／free。这里的合成包与规则通过不计入真实模型或语义通过。

真实 M3：第一批运动生成约 30 秒超时、音乐结构失败；修复后运动生成并发布用时 9.3 秒，音乐第二批失败、单主题再次重试用时 8.9 秒并发布。两个正式包的 `source=llm_generated`，只准入受限情境／开场字段，辅助审阅并非人工认证。当前已发布两包的 8 组四学习者初始化 **0/8 LLM、8/8 rule**，均为约 9.95 秒的 `planner_timeout`；8 组逐轮 **0/8 LLM、8/8 rule**，约 1.80 秒且全部在 2 秒预算内。真实 M3 规划可靠性未通过，固定数据上规则目标并不说明模型做出了自适应决策。原 28 案的真实模型批次记录为主题范围 24 案 0/24 LLM；该批生成当时只有运动包成功，因此作为失败诊断，不是当前两个包的质量分数。元数据分别保存在 `.local/topic-eval/real-report.json` 和 `.local/topic-eval/live-planning-report.json`。

真实豆包：`npm run probe:planning:voice` 使用已发布运动包的初始上下文，观察到 session ready，按 5 秒期限结束；初始 Planner 为 rule 降级。它只验证连接与初始配置，没有上传麦克风音频、验证双向音频、浏览器播放听感或 controlled 本轮生成。

后续更强模型确定后沿用同一契约与冻结样本重测，重点看 Topic Pack 主题适配、初始化有依据目标与无目标、2 秒内 LLM 完成率，以及逐轮语音实际遵循。语义质量与真人设备验收保持开放。
