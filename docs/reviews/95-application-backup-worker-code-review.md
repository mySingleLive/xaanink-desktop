# 95 应用备份 worker 接线独立代码审核

审核者：`/root/product_review`。日期：2026-10-08。结论：本轮限定范围 PASS，四个真实失败分支已修复并保持原断言通过，正式冻结指纹已核验。未授原生、Windows 或 531 正式验收。

## 范围及独立性

依据 `implementation-27/application-backup-worker-contract.md`，审核 shared/control 严格 RPC schema、ApplicationBackupControl 摘要转换、Workspaces 的 applicationBackups 与 create/open 注册保护、worker index 的 application-backup 和 closedForMaintenance 接线。完整 Workspaces/index 文件的指纹用于记录时点，不能把其旧业务整体纳入本轮。

26 Session、22 在线快照、17 备份与语义校验、原 Workspaces 租约、23 closed target 等为只读依赖；没有重新审核其核心。29 库存/根迁移模块由本 reviewer 编写，在本轮只列依赖，绝不自审为 PASS。没有修改任何作者生产源或作者断言。

## 发现与修复复验

| ID / 严重程度 | 实际问题 | 最小修复与复验 | 状态 |
| --- | --- | --- | --- |
| AB95-C01 / P2 | Session 捕获 engine A，但 `current()` 读取动态 `connection.engine.closed`。物理 lease await 期间同 Connection 换成可用 engine B，旧 A 仍能获授权。 | 作者固定 engine/db 引用，并在 lease 前后检查精确引用及捕获 engine.closed；独立 AB95-01 保持原拒绝 oracle 通过。 | 已关闭 |
| AB95-C02 / P2 | 同一个 slot 的 connection Promise 替换后，旧 Session 仍能沿用已脱离 pool 的 Connection；后续 close 使用新 Promise，不能代表原 engine 关闭。 | 作者固定原 connection Promise 并同时核验 slot/Promise/engine/db；独立 AB95-02 原 oracle 通过。 | 已关闭 |
| AB95-N01 / P1 | create 已检查 root alias 后，在 catalog.read await 中 alias 指向新根。原合法 native 选择落入当前备份 namespace，方法写作品 manifest 并抵达受控 engine。 | 作者捕获本次 canonical 应用根 dev/ino，副作用、engine、catalog CAS 之前同步检查根身份与 namespace；独立真实 FS/native proof 用例保持原拒绝及无写入 oracle 通过。 | 已关闭 |
| AB95-N02 / P2 | open 在异步 validateWorkDatabase 后没有复核 root，alias 切换后依然抵达 engine/注册。 | 同一注册 guard 贯穿验证、connect 内部等待及最终 catalog beforeCommit。普通历史 list/run 不增加此 guard；独立原拒绝和 manifest 字节不变 oracle 通过。 | 已关闭 |

C01/C02 的纯行为 RED 是 `review95-02-corrected-connection-red.tap`（0/2）；N01/N02 的纯行为 RED 是 `review95-04-corrected-namespace-red.tap`（0/2）。源码由作者修复，未改独立行为断言。

## 独立检查方法与真实结果

三份独立测试共 11 项：

- `application-backup-95-review.test.ts` 六项执行原 Workspaces 完整 class body及原 serialize/run/close、真实 AsyncLocalStorage、真实根目录身份。Session/engine/DB 为受控依赖，不打开数据库。其中一项执行原 lockDirectory 函数与真实 owner.json，改变 token 后原租约检查拒绝发布；不是布尔模拟失效。
- `application-backup-95-namespace-review.test.ts` 两项直接导入真实 Workspaces，使用真实 DirectoryAuthority 授权与目录/符号链接。仅替换指定等待入口与禁止开 engine 的受控依赖，实际 create/open 保护和文件 IO 不替换。
- `application-backup-95-rpc-review.test.ts` 三项执行当前 worker 的实际 RpcPeer callback，验证 physical close Promise 尚未完成时没有 closed proof、关闭失败不签 proof、任意可能开 engine 的 action 在输入校验前撤销旧 proof、公开结果只含 whitelist 字段与固定安全错误。外部 worker 对象受控，不称真实进程关闭。

独立 `review95-08-complete-independent-green.tap`：11/11 通过。最终独立相关 09 运行 9 文件 32/32（15 作者 + 11 独立 + 6 既有），0 fail/skip/cancel，进程实际 exit 0。10 全量 TypeScript 进程实际 exit 0、空诊断。这些共享回归不能累加为产品正式用例覆盖率。

新守卫的首次 GREEN 覆盖 lazy loader 与 cleanup 仍受原 active/queue 保护、close 等待 physical unlock、关闭后的 queued/new 请求不能 reopen、DB context 引用漂移拒绝、实际 lease owner token 漂移拒绝、public 无路径/Key/manifest 等。原失败四项的复验均保留原 oracle，没有降低判据。

`review95-01-connection-red.tap` 实际是 reviewer harness 漏 catalogSchema 依赖；03 漏 await consume；05 漏原 lockDirectory 的 realpath 依赖；07 RPC 生成代码 return 少空格。这些过程日志保留，明确不算产品 RED。校正仅发生在 reviewer 夹具，不修改生产或安全/数据 oracle。

## 作者实际引擎证据及未验收范围

只读引用作者 `application-backup-control-14-actual-worker-attempt.tap`：唯一实际 built worker / 原 Prisma schema / PGlite host 1/1 通过、约 232538 ms，实际模板、向导、不可调用历史模型引用、未关联会话/消息 roundtrip、backup 回执后 close ACK、清理与 list reopen 均执行。这个 host 在新增精确引用和 alias 身份修复前跑正常路径；reviewer 没有执行或重复它，不能宣称最终修复的异常分支经过真实 PGlite。修复异常分支证据是上述独立小 FS/原方法检查。

未接 main/renderer gate、菜单、定时器与应用恢复激活不列本轮缺陷；它们属于后续任务。没有真实 Electron shutdown/session 静默、OS picker、Windows 持久化、坏源离线恢复或 531 正式顶层验收。公开 list 在线打开原 inbox，坏/失联源 fail closed；不静默新建替代数据库。

## 冻结核验

作者正式 v1 `application-backup-worker-frozen.json` 共 12 作者文件 + 3 独立测试 + 99 只读依赖 + 30 稳定证据，144 份 SHA 全部匹配，immutable-v1 同字节。按 ordered files + independentTests + dependencies + evidence 的 path:sha256、LF 且含最后 LF，聚合 `97efd08cc3313cb0d52c23c12b7344e23de1cc2e82e9240e140fada6433a85d3` 完全匹配。独立记录 `review95-11-final-manifest.json`，不回写 17/26/29 等历史冻结。
