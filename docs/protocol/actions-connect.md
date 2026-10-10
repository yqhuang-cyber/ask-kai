# Actions 真实连接探针

Task 10 的第一部分：使用 GitHub Actions Repository Secret `DOUBAO_API_KEY`，从短期 runner 发起一次真实豆包连接。密钥只传给调用步骤的环境变量，不写入源码、profile、报告或 `.env`。不访问外部 HSKai，不自动调用 Judge 或 Langfuse。

## 范围与协议审核

`seeduplex-connect.profile.json` 从已有 Seeduplex 模板复制，仅将静态连接审核 `reviewed` 标为 true，并添加 `review_scope=static_session_connect_only`。核对依据是 [官方 PDF 与 Demo 映射](seeduplex-integration.md) 和 [官方接入必读](https://docs.volcengine.com/docs/DoubaoVoice/access-mustread?lang=zh)：固定全双工 endpoint、`X-Api-Key`、model `1.2.6.1`、JSON 帧、`session.create`、`session.created/session.id`、显式 PCM 格式和无上行音频时的 `input_audio_mute.commit`。音色沿用官方 Demo 示例；账号是否有此模型和音色权限由本次实际调用检验，不预先认定。

`realtime.reviewed` 与 `realtime.ordered_acks_reviewed` 仍为 false，现有模板保持全部审核开关关闭。这个专用 profile **不能直接启用 Web 语音**。收到会话就绪只证明该次配置建立过真实会话，不证明取消、更新、terminal owner、ASR、语速、教学内容、字幕或设备验收通过。

探针总预算约 5 秒（包含建连），最多 64 个事件／每帧 64 KiB；禁止重定向和压缩，握手超时 5 秒。只发送会话创建、就绪后的静音与退出时的关闭；不上传麦克风或合成音频，不请求模型主动生成回复。首次连接或实际服务运行仍可能计费。不会自动重试失败调用。

## 启动

1. 仓库 Settings → Secrets and variables → Actions → New repository secret，名称 `DOUBAO_API_KEY`，值为已开通语音服务的 Key。不要提交 `.env`。
2. `.github/live/doubao-connect-request.json` 包含固定请求 ID 与审核 profile 的 SHA-256。只有该文件在 main 上变更时才通过 push 启动专用工作流；更改普通业务代码不会调用豆包。首次提交这个文件启动本次已授权测试。
3. 如需复测，可在 Actions 的 **Doubao live connection probe** 中对 main 手动启动，或更新请求 ID 后提交请求文件。每次均为实际调用，避免无目的复跑。
4. 查看 **Live metadata-only connect (5 seconds)** 步骤和 `doubao-connect-metadata` artifact。Artifact 仅保留 3 天。日常 Foundation checks 不使用真实 Key，继续运行离线／合成检查。

## 结果

- `status=passed`：实际观察到 `session.created` 和有效会话 ID，持续到短时预算结束。
- `status=blocked`：缺少 Key，未进行网络调用。
- `status=failed`：传输、协议、供应商错误、主动断线或没有观察到有效就绪；不会把 socket 打开当作成功。
- `http_status`：握手被拒绝时的数字状态码，不能单独断言是无效 Key、缺权限、额度或网络原因。
- 事件记录仅含固定 allowlist 类型、字节数、时间、字段名和每次探针随机盐处理的 ID；不含实际 ID、响应正文、鉴权头、供应商错误文字、逐字稿或音频。
- 退出后 `provider_connected=false` 是连接已清理的正常状态；本次是否就绪看 `session_ready_observed`。
- `voice_behavior_tested`、`real_experience_accepted` 和实时 ACK 审核字段始终 false。

本地可运行 `node scripts/actions-doubao-probe.js --preflight`，不会联网。测试使用虚构 Key 与本地 HTTP／WebSocket peer，覆盖缺密钥、profile hash、阶段边界、真实握手状态与禁止重定向；不代表真实供应商结果。
