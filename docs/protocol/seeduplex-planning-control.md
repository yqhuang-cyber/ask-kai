# Seeduplex：外部规划的生成控制核验

2026-10-14，通过支持 JavaScript 的浏览器重新读取官方 [全双工 API](https://docs.volcengine.com/docs/DoubaoVoice/endtoend-realtime-voice-full-duplex-version?lang=zh)（页面更新 2026-10-12）和 [接入必读](https://docs.volcengine.com/docs/DoubaoVoice/access-mustread?lang=zh)（页面更新 2026-09-28）。普通网页抓取只返回 JavaScript 提示，不能据此认定文档不可用。没有上传密钥、音频、私人日志或执行供应商 demo。

## 静态证据与当前判断

| 官方能力 | 可支持的判断 | 外部逐轮 Planner 仍缺的证据 |
| --- | --- | --- |
| session.create／update instructions 与 updated 回执 | 可以建立／更新会话指令 | 自动回复生成前是否等待当轮新指令 |
| speech_text_buffer.replacement.append／commit，示例含 text | 可以提交回复干预文本 | 是否能在首段自动输出前可靠阻止生成、对应何轮、取消与迟到行为 |
| Function Calling 的 call_id 配对与工具结果回传 | 有工具调用时，结果回传后模型可继续最终回复；接入必读说明并行结果须聚合 | 每个学生话轮强制调用规划工具的官方配置、工具调用前输出范围、断线／失败时是否会绕过工具 |
| input_audio_buffer.commit | 可强制结束输入 | 不是关闭自动生成、等待外部规划的证明 |
| response.cancel | 取消进行中的回复 | 生成可能已经开始；取消不能追溯证明计划先于生成 |

以上两个页面未提供足以核验“每轮关闭自动生成，再显式触发生成”的完整契约。这是本次阅读范围内的证据缺口，不能推断所有豆包产品或账号都不支持。其他厂商同名事件与内部 ReplyExecutor 不作为 wire 依据。没有向当前账号发送猜测字段，现有 profile 的 reviewed 标记也不增加新的生成能力。

## 保持的运行边界

保留豆包实时全双工和 next_turn_advisory：初始计划在建连前应用，逐轮计划在安全边界更新后续输入。controlled 仍返回 CONTROLLED_REALTIME_NOT_VERIFIED，不发起连接。没有引入独立 ASR／TTS。

Function Calling 是后续可以专门核验的候选路径，但本次没有把它改造成生产门控。需获得准确产品／账号的强制调用契约，再验证：持续采音下每轮必经规划、工具前无不受控输出、call_id／输入／计划同归属、新输入取消旧规划、工具失败不绕过、超时与费用。提示词要求“每轮必须调用”不能代替服务端保证。

真实连接探针只证明所选初始指令被发送且供应商返回 ready；播放缓存、ACK 或连接成功均不进入当轮受控生成成功分母。运行结果另见动态目标验证报告。
