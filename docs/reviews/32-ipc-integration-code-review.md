# IPC 与工作台接入边界独立代码审核

日期：2026-10-07（Asia/Shanghai）。范围：`desktop/shared/ipc.ts`、`desktop/service/rpc.ts`、`dispatcher.ts`、`index.ts`、`routes.generated.ts`、`desktop/main/index.ts`、`desktop/preload/index.ts`、`src/lib/desktop/transport.ts`，并定向阅读 `context.ts`、`Workspaces.runWithGlobal` 与现有 globalPrisma 调用点。CodeGraph 工具当前不可用，使用定向源码阅读。只修改本记录，不修改实现、不操作主代理正在使用的浏览器或 Electron 窗口。

## 最终结论

**本批代码审核通过。** IPC32-01–03 已修复并经定向复审，范围内没有待处理阻断。独立执行请求契约、RPC 和 renderer transport 共 5 个顶层单元测试，5/5 通过；另复核实际构建 worker 的全局模板与作品归属，以及 service 入口取消后迟到响应的 reader 释放。下文区分真实 worker、受控依赖探针与仅源码核验，不据此宣布桌面业务或双平台验收完成。

## 问题与修复闭合

| 编号 | 原问题与发现证据 | 最终修复与复核 |
| --- | --- | --- |
| IPC32-01 · 已闭合 | transport 在读取 request body 后仍可能发送已取消请求；无限 body、等待 headers 及早到 port 的微任务时序曾导致等待不结束或端口不关闭。main 在 await 之后才登记 owner，取消无法到达尚在启动的请求；worker 提前移除 starting 存在旧任务清除同 ID 新任务的竞态。最后定向探针还证明取消后迟到 response 的 underlying body 保持 locked=true。 | main 在首个 await 前登记 owner，取消幂等，贯穿目录返回/授权消费/响应发布；端口 close、renderer destroyed/crash/main-frame navigation 清理 owner。worker 取消保留 starting 占位至任务 settle，按 controller 身份删除，close 等待 pendingStarts。transport 对 body/header/port 使用统一失败竞速、取消正文 reader、各 await 后复查失败，并在收到 port 时立即绑定局部引用以关闭微任务空窗。最后的迟到 response 分支通过 cancel 的 finally 释放 reader；独立正常 cancel 与 cancel 抛错两场景均 requestRejected=true、cancels=1、locked=false，close 成功。原生窗口/目录取消清理仅做源码时序复核，未冒称 Electron GUI 验证。 |
| IPC32-02 · 已闭合 | RpcPeer.dispose 后新 call 仍 postMessage 且永久等待，worker 退出可能留下死亡 peer；发送异常也可能遗留 pending。实际类探针确认 dispose 后 sent=1、25ms race 仍 pending。 | disposed 标志拒绝未来调用，不发送、不建立 pending；dispose 拒绝现有等待并移除 listener，发送异常删除 pending；异步 dispatch 在 dispose 后不回包。worker error/exit dispose peer，main 广播 service-disconnected 并取消 owner，renderer 拒绝正文、headers 和流读取等待。独立 RPC 两项回归通过。 |
| IPC32-03 · 已闭合 | workspaceFor 对全局路由采信无关 query/body novelId，模板管理写入作品副本而 renderPrompt 读取全局库。真实现有 dist worker 曾出现全局模板 29 条，带 novelId 后 200/0 条；POST 返回 201，visibleWork=true、visibleGlobal=false。headers 大小写还会改变 JSON 作用域解析。 | 生成路由显式声明 scope，先匹配路由再选择数据库；global 固定 inbox，忽略无关 novelId，chat 先定位会话再校验作品一致性。请求头统一小写并拒绝重复大小写键。独立真实 dist worker 复核 GET 带作品 selector 与全局结果相同，POST 带 query/body novelId 后可由不带 selector 的全局 GET 读回；原 theme handler 正确作品返回 200，未知作品拒绝。 |

上述修复由主代理实现，复审代理未修改运行代码。已有 RED 记录分别见 `docs/evidence/implementation-02/rpc-review-red.tap`、`routing-review-red.tap`、`transport-wait-red.tap`；其中 transport RED 记录的是无限正文等待失败，不能称其也捕获了后来发现的所有微任务和 reader 锁问题。后两项另由本审核的定向实际模块探针发现并复核。

## 权限、背压与数据作用域

- main 的公开 IPC 核验当前窗口 webContents、mainFrame 及 `xaanink://app` 来源；preload 仅公开有限 bridge，不暴露任意 ipcRenderer、文件读取、shell 或 worker RPC 方法。目录 grant 限定 purpose/owner、一次性消费，renderer 不能用 create/open-work 指定未经原生选择授权的裸路径。
- 请求契约严格校验版本、UUID、方法、路径、头字段与 8MiB 正文，流式正文在读取过程中也受上限约束；拒绝越界路径、cookie/账号头、未知字段及未知 worker 命令。静态路由注册不会按输入构造 import 路径；协议 realpath 核对 out 边界，renderer 导航、webview、弹窗与远程网络受主进程限制。
- 响应按 pull 读取、递增 seq、单个未完成 read、每帧最多 64KiB；worker 对较大 chunk 保留 remainder，renderer 校验帧类型/大小/顺序。暂停消费不会通过该通道无界主动推送所有帧。EOF、消费取消和取消后迟到响应释放 reader、完成请求 scope；有限未读 body 的真实 worker close 探针正常完成。此结论不涵盖任意业务 handler 忽略 abort 的无限后台任务。
- runWithGlobal 在请求期间持有 inbox 与作品 scope，globalDatabase 来源是可信 inbox context；scoped client 在实际调用时解析 ALS，不缓存作品 client，无可信 global context 拒绝借库，事务内仍禁止重新借用。cost-config/network-retry/timeouts/renderPrompt 及正文审核模板读取使用 globalPrisma；模板管理的 request prisma 由 global 路由保证落到 inbox。后台 retainer 的最后写入与退出 flush 交由第 33 号独立审核，不在本记录重复宣称完成。

## 独立验证与真实边界

Node 24.18.0 执行：

```text
node --import tsx --test tests/unit/desktop-transport.test.ts tests/unit/ipc-contract.test.ts tests/unit/rpc.test.ts
tests 5, pass 5, fail 0, cancelled 0, skipped 0
```

transport 的一个顶层测试覆盖不结束正文的 abort/service-disconnected、等待 headers 时断开，以及早到 port/已 fulfilled headers 的微任务 0–5 阶段 abort；要求 fetch 或 body 及时拒绝且 port 关闭。它使用实际 transport 模块和 Node Request/ReadableStream、可控 bridge/port，不是 Chromium/preload/main 的三层端到端验收。

真实 worker 探针使用主代理当时已构建的 `dist/service/index.cjs`、实际迁移/Prisma/PGlite、原模板/theme handler、隔离临时 app/work 目录，关闭后清理；未用真实用户作品、密钥或付费模型。取消后迟到响应的两个额外探针以内存转译执行当前实际 service 入口、RpcPeer、request schema 与真实 ReadableStream，仅将 Workspaces/Dispatcher/seed/model transport 换为可控依赖，确认取消成功及取消抛错都释放锁并可关闭；不能将其称为实际 worker 数据库集成或原生 GUI 测试。

主代理的 `tests/integration/desktop-worker.test.ts` 另覆盖真实构建 worker、原 theme handler、非法路径/未知命令与全局模板读写。本次为避免覆盖正在启动的 App 构建产物，未独立重跑该整项构建测试；上述真实现有 worker 探针与源码复审单独记载。完整 tsc、首次原生启动及 GUI 证据均属于主代理，本记录没有将其合并为独立双平台验收。

SettingsDialog/Model UI 完整接入、后续正在开发的模型 service/SDK→mainGateway 接入、根迁移/stale 锁恢复，以及第 33 号审核的后台任务/退出写入，不属于本批通过范围。没有把原型证据合并为实现证据，也没有由这些叶级检查将正式顶层业务用例、真实 Electron/Windows 或真实供应商状态改为 passed。
