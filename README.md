# Ask Kai

面向 HSK 1 初学者的实时中文对话教学 Agent。

> 更新于 2026-10-14。当前为独立 Web POC：真实豆包语音＋本地 Mock 业务数据。动态初始化、会话／逐轮规划、目标替换／暂停／停止及 free 自愿练习已接入；语音保持豆包实时全双工，当前为 next_turn_advisory。381 项测试、三个回放和 Chromium 合成设备检查通过；M3 输出稳定性、语义质量、本轮生成门控及完整设备验收仍开放。

[产品介绍](#1-产品介绍) · [架构设计](#2-架构设计) · [三个入口](#3-使用方式三个入口) · [评测](#4-评测机制与现有结果) · [现状](#5-实现范围与当前状态) · [计划](#6-接下来的计划) · [启动](#7-快速启动) · [文档](#8-文档导航)

## 1. 产品介绍

Ask Kai 希望让学生在真实交流中学习中文：既可以承接刚完成的 Mission，也可以围绕一个主题练习，或从自己感兴趣的事情开始聊天。Kai 先理解学生想表达什么，再选择适量示范、澄清、追问或练习；学生可以换话题、拒绝教学、随时打断或结束。

三个入口共享同一位 Kai、实时语音、渐进字幕与有来源的会话小结：

| 入口 | 使用目的 |
| --- | --- |
| Mission Call | 把 Mission 中的内容带入后续生活交流，按学生情况巩固、补缺或迁移 |
| 主题式对话 | 围绕选定主题，根据兴趣选择内容，根据学习证据选择目标与策略；当前示例为运动 |
| 自由聊天 | 学生话题优先，按能力与偏好适配交流；初始教学目标为空，允许零知识点 |

目标教学闭环是：根据入口和学生背景制定整体计划，在每轮对话中观察实际表现、规划下一步、执行并获得反馈。一次完整交流可以没有教学动作；计划或关键词命中不能直接证明学生掌握。

当前 POC 已有实时对话、动态初始化、会话／逐轮 M3 计划和有来源尝试；逐轮建议在回复边界更新后续输入，完整本轮受控生成尚未验证。产品要求见 [PRD](docs/prd/ask-kai-agent-prd-v1.1.md)。

## 2. 架构设计

### 2.1 Agent 核心能力

采用七类能力描述 Ask Kai 的参考架构。它们是职责视角，不要求拆成七个服务；一个工程模块可以承载多项能力。

| 核心能力 | 在 Ask Kai 中回答的问题 | 主要工程落点 |
| --- | --- | --- |
| 目标与约束 | 本次希望达到什么？学生选择、教学规则和权限允许做什么？ | M3 Agent Core；M2 执行权限与运行约束 |
| 感知 | 学生说了什么、想表达什么？发生了打断或拒绝吗？前次动作实际发生了什么？ | M5 语音事件适配、M2 事件归属、M3 意图与表现理解 |
| 记忆 | 学生的兴趣、学习证据和近期记录是什么？本会话正在做什么？ | M4 三类学生数据；M3 会话工作状态 |
| 规划 | 整体路径是什么？根据当前差距和最新上下文，下一步怎样推进？ | M3 Agent Core 的整体与逐轮 Planner，使用 MiniMax M3；当前为 next_turn_advisory |
| 决策 | 哪个行动适合当前学生？提案是否有效、允许且仍适用？ | M3 规划／策略校验；M2 接受与执行归属 |
| 行动 | 如何执行回复、示范、澄清、词卡和获准的数据操作？ | M3 教学动作；M2 编排；M5 语音；M1 呈现；M4 业务读写 |
| 反馈与适应 | 实际效果与计划相差多少？需要减少支架、调整或暂停吗？ | M3 观察与证据；M1／M2 执行和播放反馈；M4 后续记录 |

模型承担意图理解、语义判断与规划；确定性代码承担权限、归属、预算、版本和取消控制。反馈用于调整计划、策略和获准记忆，不等于自动修改生产提示词或训练模型。

### 2.2 五个核心工程模块

下图展示当前模块连接。M2 与 M3 在同一网关进程中，M1 由其静态服务提供，M4 的 Mock HTTP 服务由启动命令拉起；模块边界不等于独立部署。状态以本节表格及第 5 节为准。

```mermaid
flowchart TD
    M1["M1 Web 交互与呈现"] <-->|"HTTP / WebSocket"| M2["M2 会话网关与运行编排"]
    M2 <--> M3["M3 Agent Core"]
    M2 <-->|"授权业务端口"| M4["M4 业务数据与课程资源"]
    M2 <-->|"语音流与控制事件"| M5["M5 模型与语音适配"]
```

| 工程模块 | 核心职责与包含内容 | 承载的 Agent 能力 | 当前实现与主要差距 |
| --- | --- | --- | --- |
| **M1 Web 交互与呈现** | 入口选择、采音、播放、渐进字幕、Start Tips／词卡、总结卡、连接与异常状态 | 感知输入、行动呈现、反馈采集 | 三入口与基本音频／展示已实现；目标、Start Tip 和词卡已改为服务端计划，准备与入口竞态已检查 |
| **M2 会话网关与运行编排** | BFF 授权、一次性票据、会话／话轮／回复状态、迟到事件隔离、打断、超时、上下文更新与回执 | 感知归属、决策提交、行动编排、执行反馈；约束落地 | 已实现准备版本核对、一次性消费和迟到规划隔离；当前自动回复可早于后台更新，本轮受控生成仍待验证 |
| **M3 Agent Core** | Kai 人设、目标与策略、语言支架、Context Compiler、整体／逐轮 Planner、计划校验、教学状态及观察／总结 | 目标与约束、工作记忆、规划、决策、教学行动、反馈与适应 | 会话和逐轮 M3 提案、校验与尝试总结已接入；Mission 从完整有限资源选择目标，语义质量及通用 KP 证据仍待验收 |
| **M4 业务数据与课程资源** | HSKai Bridge／数据端口、本地 Mock；身份、偏好、Mission／主题资源、个人画像、学习画像和近期记录 | 长期记忆输入、目标／知识依据、工具读写、反馈保存 | 三类合成资料、有限完整课程、A～E fixture 和自愿尝试写回已实现；记录仅存进程内存，生产持久化待补 |
| **M5 模型与语音适配** | Doubao Adapter、供应商事件映射、音频格式、上下文／取消控制；MiniMax M3 PlannerPort 与受控生成能力边界 | 语音感知、模型推理能力供给、语言／语音行动及执行回执 | MiniMax M3 提案与豆包全双工已接入；没有已验证的本轮生成门控，controlled 保持关闭 |

实现位置：M1／M2 在 `apps/realtime-gateway/`；M3 在 `packages/agent-core/`；M4 在 `packages/hskai-bridge/` 与 `apps/hskai-mock/`；M5 在 `packages/provider-doubao/`，合成供应商在 `packages/provider-replay/`。

### 2.3 支撑与治理

可信课程知识与学生记忆分开管理：课程资源说明可以教什么，学生记录说明实际经历和表现；Context Compiler 选择本轮相关信息。当前已支持三类 mock 数据及有限 Mission／运动资源，未知和截断明确标记；外部业务和通用资源检索未接入。见 [实施记录](docs/dynamic-planning-implementation.md)。

Harness 的横向职责覆盖五个模块：状态版本、权限、取消、预算与幂等；数据来源、更正和删除；可观测性、评测与版本发布；教研审核和人工复核。当前有基础运行／策略边界，生产多机构隔离、完整持久化和真人接手另属产品化范围。本地 Mock 回执不代表真实账号、实际监护同意或真人处理完成。

评测运行器 `apps/eval-runner/` 是独立验证支撑，通过生产入口采集与回放实际行为；它的 `agent-harness.js` 是评测驱动器，不是生产 Agent Core。LangChain Judge／Langfuse 为可选配置，不是 POC 启动依赖。

参考：[Agent 动态决策与环境反馈](https://www.anthropic.com/engineering/building-effective-agents)、[企业 AI 应用设计](https://learn.microsoft.com/en-us/azure/well-architected/ai/application-design)。项目中的实际取舍以当前实现与 [Harness Review](docs/tutor-agent-harness-review.md)、[Pi 理想设计](docs/pi-ideal-tutor-harness-design.md) 为准。

## 3. 使用方式：三个入口

三种入口共用持续采音、随时打断、慢速选项、中文优先与按需短英文支架，以及结束后的有来源小结。只有供应商真实就绪后才申请麦克风并显示连接成功。语音在 Kai 说话时仍可上送，实际 AEC、停顿、打断和字幕体验需分别验收。

### 3.1 Mission Call

适合在 Mission 后把刚学的内容带入交流。当前使用本地签名的已完成 Mission 示例及其完整有限资源，结合三类学生资料选择承接目标；示例完成不等于真实课程完成或能力掌握。

| 阶段 | 学生体验 | 当前行为 |
| --- | --- | --- |
| 进入 | 选择 Mission 后对话，查看本次练习方向 | 准备本次计划，显示从全部可信候选中选择的目标 |
| 交流 | 分享、求助或尝试表达，Kai 提供适量支架 | 短回复与规则教学建议已接入，实际自然度仍需验证 |
| 调整 | 可换题、拒绝、打断或结束 | 原目标可暂停；打断清理旧输出 |
| 小结 | 查看实际练过的表达和可再练项 | 仅受支持目标有证据；Mission 完成不等于掌握 |

### 3.2 主题式对话

学生选择主题后进行相关交流。当前只有运动示例；根据兴趣选择内容、根据学习证据选择喜好／简单时间表达目标及支架。Start Tip 与词卡来自所选目标的可信资源。

| 阶段 | 学生体验 | 当前行为 |
| --- | --- | --- |
| 进入 | 选择运动，查看目标和可选 Start Tip | 显示已接受计划中的目标及可选提示／词卡 |
| 交流 | 聊喜欢的运动，需要时获得短示范 | M3 提案经校验后作为后续输入建议；实际语义质量单独验收 |
| 调整 | 继续聊内容，或换题、拒绝、打断 | 已尝试后减少支架；换题／拒绝暂停原目标 |
| 小结 | 查看实际表达尝试，选择是否再聊 | 支持的喜好句／限定时间句记 attempted；其他 KP 未评估 |

### 3.3 自由聊天

学生可以先提问题、讲生活或从一个词开始。Kai 尊重当前话题，必要时澄清或帮助表达，不强制完成运动课。

| 阶段 | 学生体验 | 当前行为 |
| --- | --- | --- |
| 进入 | 选择开放式对话，提出自己的话题 | 通用人设与已授权偏好，无预设运动目标 |
| 交流 | 分享或追问，Kai 先回应意图 | 普通交流允许零知识点；求助可给单点支持 |
| 调整 | 随时换话题、拒绝教学、打断或结束 | 当前意图优先于旧偏好和教学建议 |
| 小结 | 看交流回顾或确有来源的表达记录 | 可显示“本轮以交流为主”；不虚构学习成果 |

### 当前实现：三个入口的技术时序

**2026-10-14：动态初始化、会话计划和逐轮规划已接入运行代码，语音保持豆包实时全双工。** 独立 mock POC 默认使用 `next_turn_advisory`：整体计划在建连前接受并编译为初始指令；逐轮 MiniMax M3 提案经校验后，在安全回复边界更新后续输入的上下文。当前没有核验本轮自动生成门控，不能声称本轮语音先经过外部 Planner；`controlled` 返回明确的未验证错误，不发起连接。真实 M3、豆包应用时序和设备体验仍待新版本验收。工程记录见[动态规划实施结果](docs/dynamic-planning-implementation.md)。

三个入口共用 `POST /api/conversation-preparations`、查询／取消和一次性消费。准备按已验证身份读取三类学生数据；Mission／主题再读取可信资源。`POST /api/sessions` 开始前重新核对同学生、入口、语速、有效期、学生及资源版本，失效则重新准备。旧客户端未传 `preparation_id` 时，由服务端使用相同模块内部准备。页面不再写死目标、Start Tip 或词卡，也不把准备完成当作语音已连接。

| 入口 | 当前动态初始化 | 页面展示与语音指令 | 证据范围 |
| --- | --- | --- | --- |
| Mission 后对话 | 读取已授权 Mission 的完整本地资源和全部候选目标，结合学习证据／近期记录选择本次承接目标；不固定 `targets[0]` | 同一计划中的目标、内容切入、可选提示和资源词卡 | 课程已完成不代表掌握；目标仅在对应资源规则支持时记录本轮尝试 |
| 运动主题 | `sports` 兼容映射为 `topic:sports`；兴趣选择内容，学习证据选择目标及支架，先修未知不擅自升级 | 篮球／跑步等内容可不同；有喜好独立表现及时间练习证据时可选择简单时间表达目标 | 喜好表达及限定时间句规则只记录 attempted；提示程度、独立使用和发音继续未知 |
| 自由聊天 | 读取三类资料，初始 `primary_goal:null`、`key_points:[]`，学生当前选题优先 | 无强制目标，提示和词卡可为空；普通交流允许零知识点 | 库外表达不自动变成正式 KP；当前不把局部求助登记为整场已学目标 |

**当前学生数据与保存边界：** 新签名 `HskaiPlanningPort` 聚合个人画像、学习画像和最近最多 10 项活动，并显式返回 available／partial／unavailable、revision、来源及截断。Mock 有 A～E 合成 fixture；普通页面仍使用固定虚构成年学习者，浏览器不能选择学习者身份。原 `/api/memory` 五字段接口继续用于查看／更正／删除偏好，更正会使准备与旧规划失效，并刷新活动会话的最小学生上下文。

学习状态来自合成后端证据，与本轮实际观察分开。结束时默认不写回；学生主动勾选保存后，提交经过校验、按 learner＋session 去重的最小尝试记录，并等待 mock 回执。没有原始音频／逐字稿或自动掌握写入；仅存本地进程内存，重启重置。写回失败不显示保存成功。

**会中目标调整：** 明确选择可替换为可信资源中的目标；拒绝／换题立即暂停，明确取消则停止目标并清空旧提示／词卡。连续两轮明确表示当前练习太难，才允许退回资源中已有的先修目标；英文、单词或沉默不算困难证据。Free 的单次求助只影响当前轮，明确要求持续练习受支持表达时，才按原身份读取课程并设目标，mode 保持 free。观察绑定发生时的目标与计划版本，总结保留会中涉及的目标。达成规则列出语义、提示和不同情境证据缺口，次数或自述不能证明独立／达成。见 [目标生命周期](docs/dynamic-goal-lifecycle.md)。

**入口 1｜Mission 后对话**

```mermaid
sequenceDiagram
    participant W as Web
    participant G as Gateway
    participant H as mock HSKai
    participant C as Initializer / Validator
    participant L as MiniMax M3
    participant P as 豆包实时全双工
    W->>G: 刷新授权，准备 mission 与 mission_id
    G->>H: 签名读取三类资料与完整 Mission 资源
    H-->>G: 版本、覆盖限制、全部候选目标与 KP
    G->>C: 根据证据规划并校验整体计划
    opt 规划模型已配置
        C->>L: 有界初始化请求，资料及可信资源只作数据
        L-->>C: 整体计划提案
    end
    C-->>G: 接受计划，或明确标记规则降级
    G-->>W: 准备完成，返回计划中的目标、可选提示／词卡
    W->>G: 刷新授权，创建会话与 preparation_id
    G->>H: 核对学生及资源版本
    G->>G: 一次性消费准备／launch，签发 WS 票据
    W->>G: WebSocket 连接
    G->>P: 创建会话，应用所选 Mission 目标与策略
    P-->>G: 经核验的真实就绪
    G-->>W: session.ready 与配置
    W->>W: 申请麦克风，开始持续采音
    Note over G,P: 当前是自主全双工，逐轮计划按下述共同路径更新后续输入
```

**入口 2｜运动主题对话**

```mermaid
sequenceDiagram
    participant W as Web
    participant G as Gateway
    participant H as mock HSKai
    participant C as Initializer / Validator
    participant L as MiniMax M3
    participant P as 豆包实时全双工
    W->>G: 刷新授权，准备 sports
    G->>H: 读取三类资料与 sports 主题资源
    H-->>G: 兴趣、学习证据、近期历史、先修与候选目标
    G->>C: 分别选择交流内容和本次目标
    opt 规划模型已配置
        C->>L: 兴趣、学习证据、历史及主题资源
        L-->>C: 内容、目标与策略提案
    end
    C-->>G: 校验并接受计划，未知保持未知
    G-->>W: 返回计划中的页面目标、提示与词卡
    W->>G: 刷新授权，消费有效准备并创建会话
    G->>H: 再核对资料及资源版本
    W->>G: 一次性票据建立 WebSocket
    G->>P: 创建会话，应用当前已接受主题计划
    P-->>G: 经核验的真实就绪
    G-->>W: session.ready
    W->>W: 开始持续采音、播放与渐进字幕
```

**入口 3｜自由聊天**

```mermaid
sequenceDiagram
    participant W as Web
    participant G as Gateway
    participant H as mock HSKai
    participant C as Initializer / Validator
    participant L as MiniMax M3
    participant P as 豆包实时全双工
    W->>G: 刷新授权，准备 free
    G->>H: 读取三类授权资料与覆盖限制
    G->>C: 动态交流策略，不设初始教学目标
    opt 规划模型已配置
        C->>L: 有界交流策略规划
        L-->>C: 无初始目标的提案
    end
    C-->>G: primary_goal 为 null，关键知识点为空
    G-->>W: 自由交流页面展示，可无提示及词卡
    W->>G: 刷新授权，核对并消费准备
    W->>G: 使用一次性票据建立 WebSocket
    G->>P: 创建会话，学生话题优先的初始策略
    P-->>G: 经核验的真实就绪
    G-->>W: session.ready
    W->>W: 开启持续采音
    Note over W,P: 学生主动聊宇宙时不强拉回旧运动兴趣
```

**共用逐轮规划与观察：** 每个已接受的唯一 `user.final` 绑定不可变输入、实际此前话轮、上一回复转发结果／播放未知、整体计划、语言与拒绝／冷却状态，调用 MiniMax M3。提案需通过字段、大小、来源引用、目标、预算及策略校验；格式修复至多一次，共用截止时间。告别等明确控制可由规则直接处理；模型未配置／超时／非法输出的保守降级单独记录。新输入、偏好更正、打断、撤权或退出使旧在线规划失效，迟到结果不进入新回合。

当前 `next_turn_advisory` **不会等待规划再让豆包开始本轮自动回复**。逐轮建议在没有活动回复、待取消或待更新确认的边界发送；ACK 只确认对应上下文版本，不能追溯证明已开始的生成用了计划。执行账本将计划接受、自动输出首次观察、转发及客户端报告分开，供应商生成起点和实际播放没有证据时保持 unknown。普通 Web 尚不发送播放消费回执，不能从转发推断听到或理解。

```mermaid
sequenceDiagram
    participant W as Web
    participant P as 豆包实时全双工
    participant G as Gateway / Coordinator
    participant L as MiniMax M3
    W->>G: 持续上送 PCM
    G->>P: 实时音频
    P-->>G: 最终识别，校验后接受有效 final
    Note over P,G: 自主输出可以早于 final 或规划；生成起点保持 unknown
    par 自主语音输出
        P-->>G: 有归属的文本、音频、完成事件
        G-->>W: 安全及旧事件隔离后转发
    and 后台逐轮规划
        G->>L: 当前 final、实际前文、执行未知及硬约束
        L-->>G: TurnPlan 提案
        G->>G: 校验引用／版本／策略，拒绝迟到提案
    end
    opt 提案仍有效，且处于安全回复边界
        G->>P: 更新后续输入上下文
        P-->>G: 对应版本的更新确认
    end
    Note over W,L: ACK 和计划不生成学习事实，也不证明本轮受控生成
```

连续 PCM 上送、原回复身份隔离、取消串行、字幕渐进与实际语音就绪规则保留。准备阶段不申请麦克风；未配置语音时 `/api/sessions` 仍返回 501。正常／普通异常结束先返回有来源总结，再关闭；安全限制或撤权清空学习展示。动态总结只展示支持目标的实际识别尝试，不生成独立使用、掌握或发音结论。

`legacy` 明确保留旧固定课／Mission 第一目标路径供比较；`shadow` 产出计划供获准观测，运行回复和页面仍使用旧行为；`controlled` 目前关闭。新主路径的本轮受控生成、完整语义知识点观察和真实成本／等待验收仍列为缺口，不能把当前工程通过视为 DP-05／06／10 已完成。见[实施与验收清单](docs/dynamic-planning-tasking.md)。

时序核对代码：[准备与身份校验](apps/realtime-gateway/src/preparations.js)、[初始化](packages/agent-core/conversation-initializer.js)、[规划器](packages/agent-core/planner-port.js)、[逐轮状态](packages/agent-core/planning-state.js)、[教学会话](packages/agent-core/teaching.js)、[实时网关](apps/realtime-gateway/src/realtime.js)、[动态观察](packages/agent-core/planning-observations.js)、[Mock 资源](apps/hskai-mock/src/planning-fixtures.js)。

## 4. 评测机制与现有结果

### 4.1 如何评测

| 层级 | 检查内容 | 机制与边界 |
| --- | --- | --- |
| 工程与契约 | 权限、话轮归属、乱序／取消、上下文、Mock 接口、页面 | 单测、合成事件回放、CI 浏览器；通过不等于真实语音或教学合格 |
| 对话内容 | 意图、知识正确性、指令遵循、教学适配、表达、连贯、目标推进、画像、人格、安全 | 十维评分＋逐项要求；实际多轮采集、模型辅助审阅，人工／独立 Judge 校准另列 |
| 实时体验 | 首音、停顿、抢话、打断、回声／噪声、渐进字幕和总结展示 | 真实供应商与设备测试；不能从文字评分推断 |
| 动态规划 | 整体／逐轮计划合理性、执行顺序与遵循、观察真实性 | 独立 fixture 与真实 M3 提案检查已接入；语义评分、真实本轮受控生成和设备验收仍开放 |

评测运行器通过生产 Agent 链路发送输入，前文采用实际 Kai 回复；参考、未来脚本与评分规则隔离。模型判断不自动更新学生事实。沿用十维权重，关键失败不能被平均分抵消。完整方法见 [内容回归](docs/p0-regression.md)、[多轮运行器](docs/multiturn-eval.md)、[真实记录评分](docs/recorded-scoring.md)。

### 4.2 最新结果

以下均为固定脚本／录音的自由会话及语言对照，不能外推为三个入口全部验收。评分来源为模型辅助离线审阅，尚无人工批准或本轮独立 Judge API 调用。

| 记录 | 范围与有效数据 | 评分结果 | 结论／报告 |
| --- | --- | --- | --- |
| 改造前全量候选评分 | 48 案／255 轮；47 案完整，244 轮评分 | 149 通过／72 待复核／23 失败；011 缺 11 轮 | 保留为历史对照；[全量比较](docs/eval-results/2026-10-13-task05-formal-comparison.md) |
| Harness 改造后针对性回归 | 26 案／149 轮；24 案完整，145 轮评分；候选 `307f56e` | 103 通过／29 待复核／13 失败；005／027 共缺 4 轮，12 项要求未评分 | **质量验收未通过**；[正式结果](docs/eval-results/2026-10-13-harness-formal-comparison.md) |

最新候选与上轮 `93b5cff` 的共同可比范围为 **134 轮**，均分 **94.60 → 96.44**；37 轮有改善、18 轮有退化，其中 2 轮同时有改善与退化；该范围关键失败均为 0。两次采集范围不同，不能直接比较总通过率；上述结果也不单独证明每项修复的因果效果。

主要残留问题：首轮语言偏好、歧义澄清、结束时长口头回顾、新表达的英文支架，以及部分采集／取消与完成信号缺口。工程侧已记录 338 项测试、三个回放和 CI 浏览器检查通过，见 [实现记录](docs/eval-results/2026-10-13-harness-cross-case-regression.md)；它们与内容质量、真设备体验分别报告。



2026-10-14 动态规划候选：363 项测试、三个回放和 Chromium 合成设备通过。真实 M3 初始化 4/6 接受 LLM 计划、1 组规则降级、1 组失败；逐轮 4/5 接受 LLM 计划、1 组降级。豆包动态初始配置连接探针收到真实就绪，不上传麦克风，不证明双向音频或本轮生成门控。见 [验证报告](docs/eval-results/2026-10-14-dynamic-planning.md)。

后续目标迭代：381 项测试、三个 synthetic replay 和多目标总结的 Chromium 合成设备检查通过。12 案／18 轮独立离线行为检查通过；真实 M3 最后完整批次初始化 5/12 接受 LLM、7/12 降级，逐轮 7/18 接受 LLM、11/18 降级。自动行为检查初始 11/12、逐轮 17/18；发现的错误收束已增加硬约束并做单案复验。这些字段／行为检查不等于完整语义合格，旧十维分数不变。见 [新验证报告](docs/eval-results/2026-10-14-dynamic-goals.md)。

## 5. 实现范围与当前状态

| 能力 | 实现状态 | 验证状态与限制 |
| --- | --- | --- |
| 独立 Web、三个入口、真实豆包语音 | 已实现 | 普通 Web 纵向验收已有用户确认；三个入口及剩余设备场景仍需补验 |
| 话轮归属、取消、上下文快照与更新确认 | 已实现 | 工程与部分真实链路已检查；仍有采集／时序缺口，不保证本轮新决策生效 |
| 短回复、语言支架、规则教学与拒绝／换题暂停 | 已实现 | 真实内容已有改善及退化，残留失败见第 4 节 |
| 渐进字幕、词卡与 Web 总结 | 已实现 | 同步按播放进度近似处理；真实设备及改造受影响项待复验 |
| 有来源的会内学习证据 | 已实现，范围有限 | 主要支持运动喜好及受支持表达；其他 KP 未评估，不输出掌握或发音结论 |
| Mock 身份、Mission、偏好和管理接口 | 已实现 | 固定虚构成年学习者；五字段偏好仅存内存，重启重置，业务闭环待验 |
| 三类学生数据、动态初始化与整体／逐轮规划 | 工程已接入，MiniMax M3＋本地 Mock | 最新 12 组真实 M3 仍大量超时／降级，规划质量待校准；当前为后续输入建议，不代表本轮先规划后生成通过 |
| 会中目标替换／暂停／停止、自愿练习与来源记录 | 当前两个可信目标范围内已实现 | 规则／网关／页面已检查；独立表达、迁移及语义达成继续未评估，真实 M3 仍大量降级 |
| 跨会话记录、生产持久化、独立发音评分 | 自愿 mock 尝试写回已实现；后两者尚未实现 | 内存记录可进入下一会话历史，重启重置；不自动升级能力，真实业务库与发音服务另列 |
| 生产机构权限与真人接手、正式服务部署 | 尚未完整实现／验收 | 当前只限本机内部 POC，Mock 回执不等于外部处理完成 |

当前 POC 不依赖外部 HSKai 仓库、生产数据库或队列。后续可通过端口替换真实业务提供方，现有 Mock 数据不能当作真实学习者信息。范围依据见 [独立 POC](docs/standalone-poc.md)；正式产品发布条件见 [发布与评测](docs/release-and-eval.md)。

## 6. 接下来的计划

现有 POC 收尾与动态规划建设分开记录，工程交付和质量验收分别判断。

| 工作线 | 近期重点 | 交付与验收依据 |
| --- | --- | --- |
| POC 内容质量 | 复核最新失败、退化与不可比轮；验证首轮语言、歧义进入生成、结束回顾收束及音频完成／取消原因；按类修复 | [正式报告](docs/eval-results/2026-10-13-harness-formal-comparison.md)、[收尾 Task05](docs/task05-implementation-tasking.md) |
| POC 体验与收尾 | 补未覆盖设备／入口旅程、偏好闭环、异常连续使用、安全与隐私边界；最后完成可重复演示 | [收尾 Task06–10](docs/poc-completion-todo.md) |
| 动态规划基础 | 目标生命周期、原目标观察来源与独立行为评测已接入；下一步集中处理 M3 契约错误、选择质量、超时与语义校准 | [DP-00–04](docs/dynamic-planning-tasking.md)、[目标迭代验证](docs/eval-results/2026-10-14-dynamic-goals.md) |
| 动态规划执行与验收 | 验证豆包本轮门控与受控执行；完善语义 KP 观察、播放消费范围、跨入口真实音频与费用验收 | [DP-05–10](docs/dynamic-planning-tasking.md) |

动态规划的核心验收条件是本轮计划先于受控生成，并依据实际执行与学生反应继续规划。用户确认保持豆包实时全双工，本轮不引入独立 ASR／TTS。Seeduplex 本轮生成门控未证实前保留 next_turn_advisory，不能用延迟播放或迟到 ACK 证明本轮受控生成。

已重新读取最新官方 API／接入必读；Function Calling 是可进一步核验的候选，尚未证明每轮强制规划及工具前输出范围，不能直接启用 controlled。见 [控制能力核验](docs/protocol/seeduplex-planning-control.md)。

完整进度见 [实施记录](docs/implementation-plan.md)。Pi 完整设计是参考输入，不要求先迁移框架。

## 7. 快速启动

需要 Node ≥22.18。默认业务后端为本地 Mock，无需外部 HSKai 地址或数据库。

```bash
npm ci --ignore-scripts
npm run verify
npm run poc
```

打开 http://127.0.0.1:4310。未配置语音时可以查看入口和偏好；不能进行真实对话，也不会申请麦克风。合成工程回放在 http://127.0.0.1:4310/dev/replay，始终标记“豆包未连接”。

真实语音需在本机 `.env` 配置服务端密钥及已审核 profile：

```dotenv
ASK_KAI_BACKEND=mock
ASK_KAI_PROVIDER=doubao
DOUBAO_API_KEY=你的本地密钥
DOUBAO_REALTIME_PROFILE=./.local/seeduplex-profile.json
```

首次设置参照 `.env.example`；已有 `.env` 保留并修改。profile 模板审核开关默认关闭，复制模板不等于已完成协议／账号验证；GitHub Secret 不自动出现在本机环境。完整步骤见 [Seeduplex 接入](docs/protocol/seeduplex-integration.md)和 [Web 音频](docs/web-realtime.md)。密钥、原始 wire trace 和真实学生录音不提交仓库。

工程检查使用 `npm run verify`、`npm run replay`；浏览器检查按 [测试说明](docs/testing.md) 执行。真实模型调用须使用已配置权限并显式启动，合成测试成功不替代真实验收。

### 7.1 动态规划配置与检查

```dotenv
ASK_KAI_PLANNING_MODE=next_turn_advisory
MINIMAX_API_KEY=你的本地规划模型密钥
MINIMAX_BASE_URL=https://api.minimax.cn/v1
MINIMAX_PLANNER_MODEL=MiniMax-M3
```

密钥仅放本机 `.env`。M3 初始化／逐轮请求与豆包实时 Key 分开；不启用额外 trace 或保存模型思维链。未配置 M3 时显示保守策略并记录 `planner_unconfigured`，不冒充真实语义规划。当前试点预算为初始化 10 秒、逐轮 5 秒，仍需真实校准。`npm run eval:planning` 使用 15 组独立合成 fixture 做离线契约检查；显式 `npm run eval:planning -- --live` 使用 6 组 fixture，最多 12 次规划请求及各至多一次格式修复，不调用豆包、Judge 或真实学生音频。`npm run probe:planning:voice` 单独验证一个动态初始上下文的真实连接，不上传麦克风。规划质量、生成因果、原十维内容和浏览器听感分别验收。

目标生命周期检查：npm run eval:goals。显式 --live 使用 12 个虚构案例，共 12 次初始化＋18 次逐轮请求，每次最多一次有界修复；--case=refusal 可限定一个案例。不调用豆包或独立 Judge；独立期望不进入模型输入。初始化总预算仍为 10 秒、逐轮 5 秒，初始化预留 50ms 提交明确降级。完整语义、当前轮控制和听感分别验收。

## 8. 文档导航

| 方向 | 主要入口 |
| --- | --- |
| 产品与范围 | [PRD](docs/prd/ask-kai-agent-prd-v1.1.md) · [独立 POC 与 Mock](docs/standalone-poc.md) |
| Agent 设计 | [动态规划实施](docs/dynamic-planning-implementation.md) · [动态规划详细设计](docs/dynamic-planning-design.md) · [Harness Review](docs/tutor-agent-harness-review.md) · [Pi 理想架构](docs/pi-ideal-tutor-harness-design.md) |
| 接口与实时运行 | [事件契约](docs/contracts.md) · [HSKai 边界](docs/hskai-bridge.md) · [协议接入](docs/protocol/seeduplex-integration.md) · [上下文快照](docs/context-snapshots.md) |
| 教学与呈现 | [自然教学](docs/natural-teaching.md) · [语言支架](docs/language-support.md) · [渐进字幕](docs/progressive-captions.md) · [学习总结](docs/session-summary.md) |
| 评测与结果 | [动态规划验证](docs/eval-results/2026-10-14-dynamic-planning.md) · [测试说明](docs/testing.md) · [多轮运行器](docs/multiturn-eval.md) · [真实评分](docs/recorded-scoring.md) · [最新正式报告](docs/eval-results/2026-10-13-harness-formal-comparison.md) |
| 开发与计划 | [POC 收尾](docs/poc-completion-todo.md) · [动态规划清单](docs/dynamic-planning-tasking.md) · [实施记录](docs/implementation-plan.md) |
| 详细参考与历史 | [原 README 参考快照](docs/readme-reference-20261013.md)：保留原完整时序、操作细节、原始路线图和历史说明，不作为最新状态来源 |

后续 README 主要更新第 4 节结果、第 5 节状态和第 6 节计划；具体运行、设计和历史过程更新对应专题文档。工程实现变化后再同步架构与当前时序，设计提案不提前写成已实现行为。
