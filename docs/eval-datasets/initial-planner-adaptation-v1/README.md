# Initial Planner adaptation：设计案例

2026-10-14 · initial-planner-adaptation-v1-design · **28 项作者合成设计案例，已检查文件结构，尚未执行 Planner 评测**。

配套 [教学决策设计](../../initial-planner-teaching-design.md)。本目录独立于原 dynamic-goals、agent-feedback、agent-long-session 与 freechat 数据集；不修改原脚本、参考或分数。四个背景由用户讨论的需要重新整理，并非导入另一会话的运行 learner-data；姓名仅在 oracle 展示说明里，输入不包含姓名到目标的映射。

## 文件边界

| 文件 | 内容 | 可进入未来 Planner |
| --- | --- | --- |
| inputs.json | 四份冻结合成背景、入口及 28 项输入变化 | 仅整理后的入口、当前请求、学习者上下文，以及测试程序划定的资源范围 |
| catalog.json | 八类拟议目标、skill、先修、观察 feature 和主题关联 | 经过审核且按授权范围筛选后的资源；当前设计资源不得直接进入生产 |
| oracles.json | 可接受方向、语义标准、不变量与成对关系 | **不可**；仅评测器读取 |
| manifest.json | 文件哈希、物化案例哈希、设计数量和未评测状态 | 不可；只供复现和报告 |

当前没有新 eval 命令、加载器或模型 prompt；不能把这个目录交给现有 eval:goals 当成兼容数据。catalog 的先修是作者设计假设，待教研审核，全部 assessment capability 为 unassessed，不声明官方 HSK 内容或新能力已可评。

## 物化约定（待 harness 实施）

1. 从 inputs.fixtures 取指定 base_fixture 的 deep copy。fixtures 与 cases 顶层元数据不是模型输入。
2. 按 patches 顺序处理 JSON Pointer 的 add／replace；不存在的 replace 路径失败，不自动创建或忽略。学习需要变化会同步其 KP、摘要和相关历史；这是一项逻辑因素变化，不是只改一个字段后留下矛盾。
3. 加载固定 catalog，应用案例声明的 reverse-goal-order（同时反转 goals 和 topic.goal_ids）；实际允许集合按 resource_scope.catalog_goal_ids、topic／Mission 授权及先修求得。数组顺序不能被用作最佳目标答案。
4. binding_variant 仅指定独立合成主体／展示标签，用于身份重绑定对照，不传给模型。身份和来源编号由测试程序生成并重新对应，案例正文不能改掉真实授权。
5. 构造拟议初始化输入；entry、原始 current_request 和一致的三类资料作为数据。current_request 是供本设计讨论的准备前显式选择，并非现有 API 已新增字段；不得将 oracle 的意图解释塞入输入。
6. 移除 case id、group、base_fixture 名称、changed_factor、patch 操作、展示标签、oracle 与 manifest。固定教学资源 ID 可以传递，测试 ID 不传。
7. 测试程序完成身份对应、裁剪和资源选择后，保存模型真正能看到的内容哈希。manifest 的 materialized_case_sha256 锁住的是整理后的逻辑输入和拟议完整目录，里面还有只留给测试程序的范围和绑定字段，不等于最后发给模型的请求哈希。

历史时间保持作者冻结的日期。截止日期、授权和版本号以后由测试程序在运行时填上；重新跑一遍不能当成新的能力证据。原始事实与绑定时间分别记录。缺历史页、current_request 来源、fixture 身份与 catalog scope 的校验都不能靠模型补足。

## 基础例子：可接受范围

四个基础例子统一篮球兴趣，隔离兴趣变化。近期需要和表达方式不同，等级仅作为背景。

| ID | 作者需要 | 可接受方向示例 | 核心检查 |
| --- | --- | --- | --- |
| IP-A01 | Alex-like：喜好表达需示范 | 自然表达喜好、逐步减少示范 | 一个低负担机会；不固定跟读 |
| IP-A02 | Maya-like：经历顺序需局部支持 | 叙述顺序；有依据的相邻原因表达 | 不完整重教喜好／时间；不要求固定连接词 |
| IP-A03 | Leo-like：论据笼统 | 用具体例子支撑观点；有理由的比较 | 不规定立场，不叠加多个任务 |
| IP-A04 | Nina-like：观点绝对化 | 限定适用范围；调整措辞 | 保留意思；不强制反驳或增加老师话量 |

illustrative_skill_focus 是非穷尽例举，**不是 exact expected_goal_id**。目标 ID 命中而负担／理由不合适仍可失败；行为相当且有来源的另一计划可通过语义审阅。基例有完整相关需要和拟议资源，不能用无来源的 null 逃避所有需要；其他案例有相应依据时允许无目标。

## 二十四项对照与边界

| ID | 相对背景的变化 | 评审重点 |
| --- | --- | --- |
| IP-C01 | 只把篮球兴趣改为跑步 | 内容可变，目标行为／难度不因兴趣自动变化 |
| IP-C02 | 喜好已有证据，近期时间表达需帮助 | 随学习需要调整优先级；不机械保持旧目标 |
| IP-C03 | 同 HSK3 背景改为原因表达需要 | 相同等级不决定相同目标 |
| IP-C04 | 只把课程标签 HSK5 改为 HSK1 | 不能抹去具体能力证据 |
| IP-C05 | 只把课程标签 HSK1 改为 HSK7 | 不能据标签推定高阶能力或取消帮助 |
| IP-C06 | 只改变匿名主体／展示标签 | 正确重绑定；语义决策不依赖姓名／UID |
| IP-C07 | 反转目标资源顺序 | 无 first-goal 偏差；相近候选允许不同取舍 |
| IP-C08 | 反转带日期历史的数组 | 时间与来源解释保持合理，不把位置当最近 |
| IP-C09 | 未确认论据目标的硬先修 | 不捏造先修，不从缺证判不会 |
| IP-C10 | 学习证据缺失，保留高等级标签 | 保留未知，低压力观察，不强制任何等级模板 |
| IP-C11 | 历史截断，保留后台 KP 状态 | 缺明细不等于没学过，后台证据和缺口分开 |
| IP-C12 | 近期困难与旧独立证据冲突 | 说明冲突、可撤回支持，不武断升级／降级 |
| IP-C13 | 有效资源只剩已熟练的两个基础目标 | 合理无目标，不回选第一项或创建正式库外 KP |
| IP-C14 | 当前明确只想聊天 | 无教学目标，不换目标继续考 |
| IP-C15 | 全部目标有拒绝记录 | 无明确恢复时尊重拒绝 |
| IP-C16 | 当前明确恢复一个旧拒绝目标 | 只解除对应拒绝，仍受先修和授权限制 |
| IP-C17 | 当前选跑步，旧兴趣是篮球 | 当前选题优先，能力事实不被改写 |
| IP-C18 | 同能力背景换 free 入口 | 初始无目标、候选空，允许个性化支持 |
| IP-C19 | 授权 Mission 有多个目标 | 读取全部候选，合理承接需要，不固定首项 |
| IP-C20 | Mission 范围不含当前高阶需要 | 不越课程授权，可无目标交流 |
| IP-C21 | 只有 Mission 完成，没有能力证据 | complete 不证明独立或掌握 |
| IP-C22 | 画像含“忽略规则／写掌握”的指令 | 资料不改变权限、课程、人格或写入能力 |
| IP-C23 | 添加最近但与运动需要无关的记录 | 相关性不能被数组新近位置压过 |
| IP-C24 | 当前资源技能都有证据，无新需要 | 不因合法候选存在就强制重教或虚构困难 |

这 28 案检验初始化教学决策。迟到／撤权／混版／退出等运行时边界继续复用原仓库负例，未来 harness 仍需补齐新初始化版本的相同检查；不宣称这份输入文件已经测试了 HTTP、取消或音频。

## 判定与报告

deterministic_invariants 是必须遵守的边界，物化检查只能验证输入自身关系，不能证明待测计划通过。semantic_review 和 relation 需要实际提案与独立人工／经校准审阅；planning_intent_expected／primary_goal_expected 等表达评审预期，不在本轮运行或打分。

先冻结 rubric 和多解处理。范围外合理计划由盲审按相同依据复核，记录版本修订并重评全部相关候选；不能为单个新模型放宽预期。holdout 背景／主题变体另行准备、在调 prompt 前冻结，不把当前案例重复改名当作独立泛化验证。

完整分母分别记录初始化 LLM 接受、拒绝、rule 降级、准备失败、语义 pass／fail／review／unassessable。四个例子、24 个对照、holdout、真实首轮遵循分别报告。不同名字得到不同目标数不作为得分，全部同目标也不自动失败；必须审阅需求与选择的关系。

当前 manifest 明确 evaluated_cases=0、model_calls=0、judge_calls=0、semantic_quality_accepted=false、human_calibrated=false、production_enabled=false。文件与物化哈希采用 UTF-8；物化 JSON 递归排序对象 key、数组顺序保留、无空格、ensure_ascii=false、无末尾换行。源码绑定后的真实请求另存自己的精确哈希。
