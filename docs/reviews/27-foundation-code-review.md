# 首批基础实现独立代码审核

审核日期：2026-10-07（Asia/Shanghai）。范围仅为 `desktop/service/database/pglite-adapter.ts`、`desktop/core/versioned-store.ts` 及对应两份测试；附首批 TDD 证据。未修改实现或测试、未审查新增全量源码、未执行 App/真实供应商/目标系统验收。

**最终结论：通过（本批限定范围）。** 初审额外复现发现的六项问题已修复或补足回归，并经独立复审闭合；没有剩余阻断项。当前 12 项 adapter 集成测试、7 项 store 单元测试及 `tsconfig.foundation.json` 类型检查通过，均无跳过。531 条顶层验收用例仍全部未执行，本结论不等同于 App 验收通过。

## 发现与修复要求

| 编号、原严重程度 | 位置与复现 | 必须达到的行为 | 状态 |
| --- | --- | --- | --- |
| F01 · P1 | adapter `connect().dispose()` 初版仅快照 active；一个事务占 lease，第二个 start 排队，dispose 后第二事务仍可打开，根查询超过 100ms 被锁住，手工 rollback 后才恢复。 | 标记 closing 后拒绝新操作，登记并等待 pending start；已排队事务取得 lease 后若连接关闭须真实结束并拒绝，不泄漏 lease。 | 已关闭：closed/pending 门与真实 rollback 回归通过；dispose 后新操作拒绝、根查询恢复 |
| F02 · P1 | 初版事务 finish 不区分终态且无结束期间查询门。rollback 后 commit 报成功而库中无数据；commit 发起后立即 executeRaw 插入仍成功且随提交保留。 | 同一种结束幂等并等待实际引擎完成；反向结束拒绝；结束一经发起便拒绝新增事务查询/写入，不伪报提交。 | 已关闭：finishKind、assertOpen 及正反向结束/迟到写入回归通过 |
| F03 · P2 | `atomicWrite` 在 open(wx) 失败时仍执行 unlink。隔离故障注入固定 UUID、预先建立同名文件后调用写入：返回 EEXIST，但预存文件已变 ENOENT。 | 仅清理由此次调用成功独占创建的临时文件；失败创建不得取得所有权或删除预存文件。UUID 碰撞由故障注入制造，不把概率低当所有权保证。 | 已关闭：ownsTemporary 仅在 open 成功后取得；新增固定 UUID 回归与独立注入均保护预存文件和旧目标 |
| F04 · P1 | 第一轮生命周期修复的结束 wrapper 在任意拒绝 finally 中删除 active。真实 COMMIT 尚未完成时反向 rollback 正确拒绝，却提前解除 active；随后 dispose 返回，而引擎 lease 仍持有。 | active 生命周期必须绑定真实 engine completion，不能因反向结束拒绝提早移除。dispose 必须等待已经开始的 commit/rollback，即使收到冲突结束请求。 | 已关闭：isSettled 观察原 engine Promise；只有实际完成才移除 active。真实延迟 COMMIT 回归及独立复现均通过 |
| F05 · P2 | 设置测试只有 rename 前失败，未覆盖目录同步失败后的提交状态。隔离目录 chmod 故障证明 rename 后同步失败抛 CommitDurabilityError(committed=true)，实际文件/read 已是新 revision。 | 补实际后提交失败测试：明确提交状态、读取权威新值、旧 revision 不能覆盖、按新 revision 重试、没有临时文件/错误删除新文件。该错误类型设计本身合理，调用层以后必须保留该状态。 | 已关闭：新增 rename 后同步失败回归，确认 revision 2 权威、旧 revision 拒绝、按新 revision 重试成功且无临时文件 |
| F06 · P2 | 初版四个原子保存测试标为 DESK-S05，而正式 S05 是右侧滚动与关闭可达；实时原子保存对应 DESK-S08。 | 修正稳定用例映射并保留历史 RED/GREEN 记录；明确叶测试只支持部分契约，不能自动标正式顶层或 GUI 用例 passed。 | 已关闭：现行 store 测试均按 S08/G03 标注；原始日志保留，其 S05 是历史误标签，不计作 S05 证据 |

F04 的独立复现使用真实 PGlite，包装 transaction callback 使其在业务 callback 返回之后、实际 COMMIT 之前等待明确 gate。按 `commit → 等待 gate → 反向 rollback 拒绝 → dispose` 执行，得到：

```text
opposing: Transaction already finishing with a different outcome
disposal: dispose-returned-before-COMMIT
lease: engine-lease-still-held
```

释放 gate 后实际提交和根查询才完成。这不是用未启动的 Promise 或普通定时器推断请求已进入引擎；故障点明确定在真实事务的结束前。

最终修复后重复同一独立场景，`dispose` 与根查询均在 gate 释放前保持等待，释放后 COMMIT、dispose 和根查询成功结束，写入行存在。固定 UUID 的独立故障注入也由“EEXIST 后预存文件消失”变为“EEXIST、预存临时文件内容保留、目标旧字节不变”。这两个复现关闭了初审中现有绿色测试未覆盖的实际行为问题。

## 已确认的正确基础

查询与 executeScript 使用原转换层，脚本等待引擎 Promise；隔离级别在已取得的事务里设置；保留原 completion Promise 使 deferred FK 的真实 COMMIT 错误向调用者传播。真实 Prisma 测试验证 Unicode/数组/JSON/日期/BigInt/Decimal、参数化 SQL、正常提交、约束回滚、事务外读写排队、超时回滚及传入 tx 的嵌套写入。没有删锁 SQL、伪造提交或改回远端数据库。

VersionedStore 单 owner 内序列化读取/写入，校验并分离输入/默认值，按磁盘 revision 作 CAS，损坏或未知 schema 不静默回到默认；临时文件先写入/同步、同目录 rename、POSIX 目录同步。成功回执只在这些步骤完成后返回；rename 前失败保留旧文件。跨进程及多实例 owner 约束仍由后续 repository/App root lock 保证，本批不宣称已经实现该层。

## 独立验证与证据边界

独立运行：

```sh
node --import tsx --test tests/unit/versioned-store.test.ts tests/integration/pglite-adapter.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.foundation.json --noEmit
```

Node 使用指定 24.19.0 运行时。初版结果为 13/13。最终生命周期和后提交故障修复后两文件合跑 18/18 通过；随后只新增临时文件冲突测试，独立重跑 store 文件 7/7 通过，adapter 实现与 12 项集成测试未再改动。最终覆盖 19 项叶测试，失败、跳过和取消均为 0；新增测试后基础类型检查再次通过。没有为无关源码扩大检查。tsx CLI 自建 pipe 在 sandbox 被拒，改用 Node 的 tsx loader 后正常执行，未升级权限、未把环境错误当 RED。

已定向读取 `docs/evidence/implementation-01/adapter-red.tap` 和 `adapter-lifecycle-red.tap`：前者包含上游隔离级别及 COMMIT 错误吞没的行为断言失败，后者有本轮关闭/终态回归失败，属于真实行为 RED。设置后提交故障和临时文件冲突复现仅使用临时目录/假数据，不读作者真实 `.xuanxiang`。

同时核对 `pglite-adapter-review-red.tap` 的第 12 项真实失败与修复后的 `review-fixes-green.tap`：该失败明确为 dispose 提前完成的行为断言。后者包含其他代理范围，整体 26 项结果仅作日志核对；本审核结论只依据上述 19 项及独立探针，不替其他模块背书。原 `settings-red.log`、`foundation-green.tap` 中的 S05 历史误标签以本记录校正为 S08，不改写原始证据。

全量源码类型检查、模型授权代码、IPC、目录迁移、原生菜单/窗控及 Windows 崩溃持久性均不属于本批通过范围。后续调用层须保留 `CommitDurabilityError.committed` 并重读 revision；多实例 owner/跨进程锁仍须按技术方案实现。上述是明确的阶段边界，不是本批已实现能力。
