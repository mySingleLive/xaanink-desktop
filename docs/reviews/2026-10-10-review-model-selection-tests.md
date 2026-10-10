# 审核模型选择专项用例

前置：技术方案独立审核通过后进入用例审核。全部使用人工模型与隔离数据库，没有真实供应商调用；只跑相关测试。

| ID | 场景 | 必须证明 |
| --- | --- | --- |
| RMS-01 | 审核为空的已有对话/失败计划回合，之后配置审核默认 | 配置本身仍不改旧任务；显式 PATCH 应用具体 ID 无生成；新手动重试实际 review SDK 发送该 ID，用量及子任务快照同源 |
| RMS-02 | 历史与幂等 | 原 Turn、原 Attempt、SopPlan 快照不变；新 Attempt 存补齐快照；同 clientRequestId 重放返回同快照，后改默认不影响 |
| RMS-03 | 后续回合与 legacy | 明确补齐后的新回合正常使用该 ID；无历史快照仍保留原文本显式 null，不偷偷补其他角色 |
| RMS-04 | 原审核非空 A，设置默认 B | 不允许此补齐操作替换 A；重试仍 A；停用/删除/Key 缺失/错类别准确拒绝，无 HTTP |
| RMS-05 | 任务与执行门禁 | 其他作者、错误会话/turn/attempt、过期最新尝试、运行中全部拒绝；失败不改变字段；已有写入/外部不确定结果仍走原重试对账守卫 |
| RMS-06 | UI 可用入口 | 已配置默认名称可见，点击只发 review-selection PATCH，不发 chat；成功告诉手动执行；无默认保留设置按钮 |
| RMS-07 | UI 并发与迟到 | 双击 single-flight；失败保留并可重试；保存中不能关闭误触发；切换会话/关闭后迟到读取与写响应不能报告当前任务成功；运行尚未终态时按钮不可用，终态刷新后可操作 |
| RMS-08 | 真实 Windows Electron | 合成旧失败任务经真实 IPC、数据库、主进程模型授权应用；原记录不改、冷重开仍持久，新手动请求捕获选择；离线窗口、无 HTTP 监听、零 pageerror |
| RMS-09 | 手动及网络重试冻结 | nextChatAttempt 复制 A；第二次手动重试继承 A；默认或会话选择改 B 仍 A；最新有效尝试有 A 时补齐 PATCH 拒绝 |
| RMS-10 | 错误来源与 UI 刷新 | 可信身份正确保留；无身份仅设置入口，畸形/多字段不成为目标；旧任务/会话切换禁配；运行中至终态刷新后允许应用 |
| RMS-11 | 数据升级/转移 | nullable 新列对旧 DB 不自动回填；同版本两库整行转移保留显式选择及尝试快照；升级前已冻结旧 schema 的迁移 bundle 准确拒绝且保留源/目标与已有 copy receipt。本次不验证或扩展旧 schema journal 自动恢复 |

相关回归：model-defaults、model-defaults-review、chat-defaults、local-task-defaults、local-review-model、local-chat-defaults 与现有 chat control 重试/副作用用例。构建和类型检查验证新增 nullable 列、数据迁移与导出 UI 兼容。不做全量回归。

PATCH 使用 selection 意图，错类别、停用、Key 缺失准确拒绝且不会打开调用提示或发送。执行结果另记 verification 文档；不把测试计划写成通过。
