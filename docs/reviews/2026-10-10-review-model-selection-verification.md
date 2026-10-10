# 已配置审核模型但计划执行仍未选择：专项验证

2026-10-10，Windows。范围仅本次模型选择、任务快照、手动/网络重试、授权门禁和相关 UI；未进行全量测试或全量回归。

## 结果

修复已完成。旧对话的审核空快照会作为显式 null 阻断，即使智能体已保存默认审核模型。新增明确的“应用到当前任务”入口，将设置中的具体审核模型保存为作者选择；后续新任务及新手动重试按此选择捕获独立 Attempt 快照，旧 Turn、Attempt、SopPlan 不重写。原已有非空选择不被替换，设置保存本身不自动发起或恢复任务。

技术方案、专项用例与 code review 均由独立子代理审核通过，见 [独立报告](2026-10-10-review-model-selection-review.md)。代码审核发现并修正了提交 A 时默认改 B 的显示竞态：保存中及成功状态均显示实际提交的 A。成功弹窗同步改为“审核模型已应用”，避免继续显示旧的无模型提示。

## 执行证据

- TDD RED：首次 `tests/integration/review-model-selection.test.ts` 六条失败；原 PATCH 对明确审核选择返回 400，真实 invoke 没有 task 身份。它们是实现前可复现缺口。初始浏览器运行的无默认入口受缺少 fixture CSS 的 inert 层阻挡，属于夹具问题，不作为该功能 RED；修复夹具后按真实按钮点击验证。
- **69 个唯一相关测试通过，0 fail/cancelled/skipped**：相关 core/集成 runner 初次 62，通过后新增一个外部副作用守卫用例；最终新集成文件 8/8 复验通过，因此该范围 core 总数为 63。真实 React 浏览器 6/6。重复执行不叠加计数。独立 reviewer 另复跑 17/17 是同一集合的独立复验，不加入 69。
- 实际 SDK 受控 transport 发出的审核模型为显式 A，UsageRecord 和 SubAgentRun 同源；默认及 Conversation 后改 B，第二次手动重试与 nextChatAttempt 仍 A；原历史及请求重放不变。原文本 null 仍阻断，无默认/删除/停用/错类别/缺 Key 均不补位。原未知外部结果、已有写入与 resume 对账门禁保持。
- RMS-11 真实旧数据库：先迁至新增两列之前、插入旧 Conversation/Turn/Attempt，再迁本次脚本，两新增字段 null，原字段保持；同版本两库整行转移保留明确 reviewModelId 与 Attempt 快照；旧冻结 bundle 因 schema 不同准确拒绝，源完整 graph 和目标完整 copy receipt 表保持相等。没有验证或承诺旧 schema journal 自动恢复。
- 最终 `next build`（含 TypeScript）和 `scripts/build-desktop.mjs` 退出 0；Prisma generate、独立 tsc 与 git diff --check 通过。新增 migration 只增 nullable 列，无删除或回填。
- **Windows Electron target-03 8 条记录通过（含两张图），0 pageerror**。真实独立注册作品、原生 vault 保存人工凭据、已提交审核默认、React 弹窗真实 PATCH/IPC/数据库持久化、正常退出/冷重开及新手动请求均执行。原历史不变、未自动发送，明确文本 null 仍在生成前阻断。16 个源/脚本/dist SHA-256 与当前源一致，reviewer 独立复核。

相关 runner：

```text
node --import tsx --test tests/integration/review-model-selection.test.ts tests/integration/local-task-defaults.test.ts tests/integration/local-review-model.test.ts tests/integration/local-chat-defaults.test.ts tests/unit/model-defaults.test.ts tests/unit/model-defaults-review.test.ts tests/unit/model-guidance.test.ts tests/unit/model-service.test.ts tests/unit/model-authorization.test.ts tests/unit/chat-defaults.test.ts tests/unit/conversation-chat-lifecycle.test.ts
node --import tsx --test tests/browser/review-model-selection.test.ts
node scripts/verify-review-model-selection.mjs docs/evidence/review-model-selection/target-03
```

`local-task-defaults` 中原 cascade fixture 有已记录的数组 adapter 错误日志，该用例只断言任务创建默认快照，不把该日志当成本次 cascade 业务执行成功。本次没有扩大修复范围。

## 实际桌面与边界

用户已正常退出旧应用，修复版随后重新启动。原模型配置、Key、作品或计划内容未被本次测试读取或改写；用户原计划的实际供应商调用仍由用户手动执行。

原生证据：[target-03/windows-electron.json](../evidence/review-model-selection/target-03/windows-electron.json)。target-01 因夹具在 inbox 直接建了未注册作品导致侧栏会话隐藏而失败；改为 Workspaces.create 注册真实隔离作品后 target-02 和最终 target-03 成功，首次失败未计通过。桌面错误通知为测试用人工调用身份注入，真实 invoke 身份与 SDK 审核路径由专项测试另证；不声称真实 DeepSeek 服务、物理 OS 点击、macOS、新安装包或全量验收通过。
