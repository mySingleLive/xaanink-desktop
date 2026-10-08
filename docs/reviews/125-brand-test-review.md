# 玄印写作改名测试用例独立审核

2026-10-08。审核依据：已通过的 `121-brand-rename-plan.md`、`122-brand-rename-plan-review.md`；用户最新中文全名「玄印写作」、简称「玄印」、英文名「XaanInk」，并要求兼容旧版数据、新建数据使用新名称。

## 结论

**测试用例审核通过，可以执行兼容范围 RED → TDD 实现。** 产品范围已经单独通过测试审核。本文是用例设计与源文件审核结论，不是实现通过、全量测试通过或平台验收通过。

审核文件：`docs/reviews/123-brand-compatibility-test-cases.md`、`docs/reviews/124-brand-product-test-cases.md`，以及 `tests/unit/brand-product-identity.test.ts`、`tests/unit/brand-names.test.ts`、`tests/unit/brand-startup-paths.test.ts`、`tests/integration/brand-data-compatibility.test.ts`、`tests/unit/brand-chat-session.test.ts`。本代理只修改本文，没有修改测试或实现，没有访问真实作者作品、配置或 Key。

## 已解决的审核意见

1. 产品 P02 原先只检查源文件是否包含新名称，可能被注释中的新名称满足。主代理已经改为 TypeScript AST 定位真实 `metadata.title`、加载 JSX 文本、Seal 的 `aria-label`、DOCX `creator` fallback、PDF `setCreator()`、协议注册/handle、入口 URL 与 preload/transport 两端端口字面量；按 `.ts`/`.tsx` 选择相应 ScriptKind。复读后通过。
2. BRN03 原先只验证应用 marker 的坏 JSON/版本，作品 manifest 仅验证双 marker。修订后增加作品坏 JSON、版本、阶段、UUID、字段类型及额外字段，验证同步/异步 reader 都拒绝并保留原字节。
3. BRN05 原先只覆盖作品 reader。修订后以 application/work 循环分别验证 symlink/hardlink、相同内容的新 inode、同 inode 的有效内容变化、竞争家族 marker 到达及根目录替换；同步/异步观察的 `assertCurrent()` 都须失败。复读后通过。

## 断言与证据边界

- 12 个 reader/classifier 用例使用独立 literal 旧/新协议夹具，不通过实现命名表构造预期值；检查冻结命名、严格 marker 配对、混合家族拒绝、只读且不初始化、文件/目录身份与原内容持续有效。
- 8 个启动用例覆盖全新路径、旧 bootstrap 原位置与自定义 pointer 优先、有效旧默认根、坏 pointer/维护记录、非空或 symlink 旧根、双权威 bootstrap、隔离状态及当前 pointer 身份替换。所有目录从隔离临时父目录传入；选择函数不创建文件或目录。
- 11 个数据集成用例独立构建原旧控制文件和真实 PGlite/Prisma 数据，验证实际保存、关闭重开、旧候选继续权威、丢失 required pointer 拒绝、新作品在两类应用根下使用当前家族、writer lease 共用及异家族锁原字节保留、真实关闭后的根迁移和 pointer 提交中断恢复。迁移验证 marker 字节、stage/migrationId、文件复制证明与解析校验和语义，没有通过全局替换旧 JSON 生成夹具。
- 2 个会话用例验证旧 session key 原文读取、新 key 保存、旧记录保留、清除两个 key，以及损坏当前记录不得回退旧草稿或覆盖。协议 origin 的实际 Electron 会话恢复仍需平台验证；Map 夹具不会证明跨 origin 的浏览器存储迁移。
- 3 个产品用例检查 npm/lock、builder 身份、菜单及实际声明位置。P03 的 `data-wordmark` 与 `<path>` 断言只证明标记和轮廓存在，真实新字形须由生成器/字体输入记录与最终渲染证据补足。

## 后续执行义务

按 123 的串行命令记录真实 RED；缺失拟议模块的 import 错误可以作为 reader/helper 红灯，但数据集成断言还须单独运行，避免用 import failure 代替业务回归。实现后运行同一用例，再执行已要求的活动核心全量测试、类型检查、构建与实际 macOS 封包检查。

现有 lease 恢复的 stale/live/unknown owner 和最终删除竞态、journal 多阶段恢复、目录重定位、两家族离线导出保护、旧配置/模板原文导入及当前格式导出必须随实现保持有效；这些属于 123 明列的其他验收范围，31 个兼容顶层用例不能代替它们。P04/P05/P06 的实际 UI、残留审计、Keychain 跨进程假凭证验证也必须分别执行并保留证据。`encryptionFamily` 单元断言不证明系统密钥可解密。Windows 未实际运行时保持未执行。

已独立复读改名前 `/private/tmp/xaanink-core-before.log` 的最终统计：**1578 tests，1551 pass，22 fail，5 cancelled，0 skipped**。这些原有失败/取消不能写为通过，也不能与改名范围的新回归混淆。本代理未运行实现后的验证；最终通过状态应由实际命令与界面证据确定。
