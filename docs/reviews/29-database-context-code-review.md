# 数据库上下文与迁移第二批独立代码审核

审核日期：2026-10-07（Asia/Shanghai）。范围：`desktop/service/context.ts`、`desktop/service/database/migrations.ts`、`src/lib/db.ts`、`prisma/schema.prisma` 的 `modelSnapshot` 增量、对应桌面迁移，以及 `local-database.test.ts`、`original-content-service.test.ts`；修复复审增加 `sql-boundary.ts` 和 `migration-boundary.test.ts`。只为确认 `src/lib/db.ts` 的原执行门控组合，定向阅读了既有 `withChatWriteFence`；没有扩大到其他业务服务、main/model repository 或 App 平台接入。仅修改本审核文件。

**最终结论：通过（本批限定范围）。** DB01–04 均已修复并经独立回归闭合，没有剩余阻断项。最终三文件15/15测试和基础类型检查通过，失败、跳过和取消均为0；未将这些叶测试等同于531条顶层用例或完整 App 验收通过。

## 发现

| 编号/严重程度 | 独立复现与影响 | 修复要求 | 状态 |
| --- | --- | --- | --- |
| DB01 · P1 | `createScopedClient` 在取属性时解析 context 并绑定真实 client。在作品 A 预取 `$queryRawUnsafe`，之后在作品 B 调用仍查 A；没有 context 时也成功；事务 callback 调用该预取函数绕过 `transactionActive`，等待自己的 lease 直到超时。模型 delegate 同样直接返回真实对象。 | 根方法、事务入口及模型 delegate 使用稳定的延迟代理，每次调用再解析当前受信 context/检查事务门。预取方法不能携带旧数据库或绕过无 context/传入 tx 要求。 | 已关闭：调用时解析 ALS；预取根/模型方法、无上下文、事务内拒绝及跨库 batch promise 回归均通过 |
| DB02 · P1 | `migrateDatabase` 接受 checksum 正确但带顶层 COMMIT 的脚本。002 为 `CREATE TABLE leaked(id INT); COMMIT; SELECT * FROM nonexistent_table` 时函数拒绝，却留下 `leaked` 表，journal 仍仅001；外层事务已无法回滚被脚本提前提交的 DDL。现有冻结目录不触发此输入，但迁移执行入口未保证所声明的整批事务边界。 | 在任何数据库改动之前拒绝顶层事务控制；只允许三份已知上游脚本的明确包装规范化。保持函数/DO 的程序 BEGIN、锁、约束和其余 SQL。不能随意删除未知 COMMIT。 | 已关闭：完整消费 $/Unicode 标识符、识别 quoted GUC；每条前固定 standard_conforming_strings=on，再以 tx.query 单语句执行，实际回归通过 |
| DB03 · P2 | 校验后仍引用 caller 的可变 Migration 对象。用真实事务 lease 阻塞入队，调用迁移后把 `row.sql` 从创建 intended 改为创建 mutated；实际创建 mutated，但 journal 记录 intended 的 checksum，函数成功。 | 入函数同步生成批次的私有不可变值快照，校验与执行同一份 id/sql/checksum。caller 在排队期间修改对象或数组不能改变已校验执行内容。 | 已关闭：同步复制/冻结 id/sql/checksum，真实入队期间修改 caller 对象仍执行 intended |
| DB04 · P2 | 新 splitter 按 `statement.words.length` 过滤。`CREATE TABLE silent_error(id INT); 123;` 的非法第二条没有 word，被丢弃；真实 migrate 返回成功、表及001 journal都已提交。 | 只过滤空或纯注释语句；其他 token 包括数字/标点/字串必须保留给真实 PG 解析，错误回滚整个 pending batch且不写 journal。 | 已关闭：hasToken 只排除空白/注释；123、普通字串、标点、dollar字串四种真实失败均回滚表、保留旧journal |

DB01 使用两份真实 PGlite/Prisma 实例，关键输出为：

```text
activeWorkB: [{ name: 'A' }]
outsideContext: [{ name: 'A' }]
insideTransaction: expired transaction after 100ms
```

DB02、DB03 同样使用真实 PGlite，分别观察错误后的系统表/journal 和 checksum 值，而非仅检查 mock 的调用次数。全部在内存库或隔离临时目录运行，没有读取真实用户数据库。

## DB02 修订后定向复审

新增 `sql-boundary.ts` 与 `migration-boundary.test.ts`。直接 COMMIT 逃逸被拒绝，普通 literals、E 字串、嵌套注释和 dollar quoted DO/function body 的单元回归通过；known wrapper 先核验各一对再规范化。第一轮词法修复曾留下以下两条真实逃逸，现已修复；保留其历史复现：

1. 合法非引号标识符的 `$` 被误作 dollar body 起点。`CREATE TABLE a$tag$(id INT); CREATE TABLE leaked(id INT); COMMIT; DROP TABLE a$tag$; SELECT * FROM nonexistent_table` 被检查器接受；真实引擎报缺表后 `_desktop_migrations`、`a$tag$`、`leaked` 仍存在。词法识别须遵循标识符含 `$` 与 dollar quote 起点的边界，不能只靠搜索配对标签。
2. 引号设置名被跳过：001 为 `SET "standard_conforming_strings"=off`；002 为 `CREATE TABLE leaked_parser(id INT); SELECT 'a\''; COMMIT; SELECT * FROM nonexistent_table; --'`。两条检查通过；第一条实际改变第二次 exec 的字串模式，使检查器认为 COMMIT 在字符串里、引擎却执行 COMMIT。真实失败后 `leaked_parser` 与 journal 表残留。必须保证每次真实 SQL 解析的模式与检查器一致，并阻止被脚本修改的解析设置沿用到下一条执行；仅拒绝裸 SET 名称不足，`set_config`/程序体也可修改后续设置。

两条均已直接发送主代理，不要求扩展到 main/model repository 或原生 App 阶段。

最后版本改为预先划分单语句、执行前 `SET LOCAL standard_conforming_strings=on`，然后 `tx.query(statement)`。独立运行确认原逃逸回归及 set_config 后的失败完整回滚；另直接验证 PGlite `.query('CREATE TABLE multi_parse(id INT); COMMIT')` 返回 `cannot insert multiple commands into a prepared statement`。因此即使词法误合并两个语句，实际 extended Parse 会拒绝整条，不能执行隐藏的 COMMIT。完整上游迁移及原正文服务仍通过，DB02 关闭。DB04 是错误语句被过滤的另外一条语义缺口；最终改为记录 hasToken、保留全部非 trivia 内容给真实引擎解析后，其四种真实失败回归亦通过，DDL/journal没有残留，DB04关闭。

## 已确认的基础与阶段边界

AsyncLocalStorage 已取代可变全局当前作品；已有测试确认直接按上下文访问的并发 A/B 请求在异步暂停后正确隔离，离开 `run` 后没有环境 scope。普通事务路径通过回调传递原 tx，并禁止重新借根客户端；原 `withChatWriteFence` 保留聊天写入锁和事务审计，没有绕过既有执行门控。DB01 是预取属性导致的另一条未受保护路径。

现有迁移 runner 校验 SHA-256 和重复 id，核对已安装 checksum/缺失项，在一个真实 engine transaction 中写 DDL 与 journal。已有回归证明普通 SQL 失败与无 word 的语法错误均回滚整个新增批次，并保留已安装001及其 schema；上游全量迁移可在 PGlite 运行。三份已知脚本当前各有一对顶层 BEGIN/COMMIT：规范化没有删除 advisory lock、FOR UPDATE、外键、部分唯一索引或 DO/trigger 程序体。本批 checksum/输入快照/整批事务边界审核通过；实际用户库升级前快照与恢复流程仍待后续实现。

原正文服务在完整迁移后的数据库验证中文内容、CAS 旧版本拒绝、operationId 相同请求重放及不同内容冲突、归属拒绝、版本快照和 receipt；effect 抛错后正文/版本/快照/receipt及同事务小说标题均回滚。当前测试不是所有原正文业务或同时写入竞争的最终验收。

桌面迁移新增 JSONB NOT NULL/default 与 Prisma `modelSnapshot` 一致；用量可引用同库 `local-author` 及无密钥、disabled 的 AIModel 引用行。现有用量测试只证明字段及 JSON roundtrip/FK 引用载体，尚未证明生产写入器的密钥排除、历史快照不可改写或全局删除后的保留策略；这些仍由后续统一用量写入/授权边界实现和正式用例验证。schema 注释和一次 create/read 不能单独证明这些能力已完成。

## 独立验证

```sh
node --import tsx --test tests/integration/local-database.test.ts tests/integration/original-content-service.test.ts tests/unit/migration-boundary.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.foundation.json --noEmit
```

指定 Node 24.19.0：初审两文件7/7；首轮修复后三文件13/13；DB02修复后14/14；最终 DB04 修复后三文件15/15通过，0失败/跳过/取消；基础类型检查再次通过。该 tsconfig 包含 context/migrations/local-database/unit 测试，不等同于完整导入源码或原正文服务依赖链全量 typecheck。主代理 `core-latest` 的51项整体结果超出本审核范围，本结论不代替其余模块审核。

已核对 `docs/evidence/implementation-01/database-context-red.tap` 的真实 scope 泄漏、A/B 交叉、借库超时及缺 journal 失败，及其4/4 GREEN；保留原始 RED。当前叶测试不能自动将531条顶层验收用例标为通过。本批未操作 Electron、原生目录/窗控、Windows、模型网络或真实用户数据。

`original-service-red.tap` 中原正文两项已通过，用量项因 Prisma 尚不接受 `modelSnapshot` 而失败；新增 schema/迁移并重新生成 client 后本次3/3通过。这是目标持久化字段缺失的行为 RED，不是缺依赖或启动失败。

`database-context-review-red.tap` 保留 DB01–03 三个真实行为断言失败；`database-context-review-green.tap` 的11项日志来自加入两个额外 delegate/batch 回归之前。首轮修复复审已独立运行13项，最终运行15项，未用旧日志覆盖新复现。

`database-splitter-red.tap` 的 `Missing expected rejection` 为 DB04 的真实失败，已定向核对；修复后的同一用例实际覆盖四种非法 token，观察错误、无残留表及旧journal三个 oracle。最终独立15/15结果取代中途13/14项结果，保留以上过程记录而不改写旧 RED。
