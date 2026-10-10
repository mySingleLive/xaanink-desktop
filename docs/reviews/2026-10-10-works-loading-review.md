# 作品列表加载失败独立审核

日期：2026-10-10。审核范围为真实作品列表读取链；未读取用户数据目录、作品正文或 Key，未启动第二个 Electron，未修改生产代码。真实现场根因由主代理继续诊断，本记录不会把代码推断当成现场事实。

## 第一阶段：读取链与初步技术审核

1. `src/components/layout/SidebarTree.tsx:123` 的 `fetchNovels` 读取 `/api/novels`，拒绝非成功响应；`SidebarTree.tsx:1397` 的真实 React Query 查询失败后在 `:1714` 显示用户截图中的「作品加载失败」及重试按钮。因此截图只能证明列表读取失败，不能区分目录、数据库、IPC 或进程错误。
2. `src/lib/desktop/transport.ts:5` 安装本地传输。`transport.ts:64` 经 `DesktopBridge.request` 请求响应头；响应正文保留 MessagePort 帧读取。`desktop/preload/index.ts:12` 映射为 `desktop:request`，`desktop/main/index.ts:515` 验证请求，`:561` 调用 worker `start`。
3. `desktop/service/index.ts:70` 的 `start` 使用 dispatcher 解析工作区，`:78` 在 `Workspaces.runWithGlobal` 数据上下文内处理。`/api/novels` 是全局查询，实际执行 `desktop/service/dispatcher.ts:84` 的特判，覆盖 `desktop/handlers/novels/route.ts` 的 Web GET 路径。
4. `dispatcher.ts:85` 先读目录索引，再使用 `Promise.all` 打开每一作品并查询本地作者非删除小说的真实摘要，然后按 `updatedAt` 降序排序。任意单个作品读取拒绝会使整个列表拒绝。`desktop/service/rpc.ts:19` 将内部异常转成普通 Error 消息；renderer 显示统一错误状态。
5. `desktop/service/workspaces.ts:148` 的 `list` 只读经过 schema 校验的索引；具体打开 `:307` 的 `run` 要检查目录身份、规范路径及作品 manifest (`:334–341`)，并经过 `connect` (`:277`) 的 writer lease、数据库和迁移验证。`workspaces.ts:61` 明确拒绝异常退出遗留的锁，不会普通打开时偷取。`workspace-storage.ts:10` / `desktop/core/work-storage.ts:42` 保持已确认存储代的权威指针，缺失或校验失败必须拒绝，不能退回旧库。

### 可能的真实数据特定边界

- 一个索引目录暂时不在、重命名/移动后身份不符、manifest 与索引不符或数据库缺失，都可在其他作品健康时使当前 `Promise.all` 全体失败。
- 一个作品遗留 writer lease 或被其他活进程占用，同样会拒绝列表；启动时收件箱锁修复不能直接证明每个作品锁都已修复。
- 应用索引本身损坏或全局收件箱打开失败属于更上游故障，不能用「部分列表成功」掩盖。
- PGlite/迁移错误、worker 断开和 MessagePort 正文失败也能产生相同 UI，因此必须以脱敏现场错误或隔离重现确定具体根因。

### 最小方案审核边界

尚未收到现场根因，本阶段仅给出实施边界，暂不批准某个具体修复。

若确认单个已关联作品不可用使全列表失败，可将列表汇总改为逐项结果：健康作品继续使用真实数据库摘要；不可用作品显式报告可重试状态，保留目录索引与原数据。不可静默删除关联、把读取失败当空列表、从不可信目录或旧库回退、自动偷锁或绕过身份/存储指针检查。若现场是全局根故障，则应修复真实根故障而非替换错误画面。

## 第二阶段：必要专项用例建议

具体测试方案待主代理确定根因后复审，以下为最低范围：

- 成功摘要契约：零作品与健康多作品，排序正确，不包含其他作者、已删除小说或正文；正式目录和数据库查询实际执行。
- 单个失效项与健康项并存：失效项不得隐藏其他健康作品；明确状态可见、重试后恢复，目录索引及数据字节不改。
- 全体不可用或索引/收件箱损坏：保持诚实失败或不可用状态，不伪造成功空列表。
- 与根因直接相关的真实边界，例如不在目录、writer lease、目录身份、缺失数据库/存储指针；只需运行本次范围，不把模拟测试标为真实目标验证。
- IPC/renderer 级验证：真实 SidebarTree 通过传输接收到约定状态；点击重试能恢复，Query 缓存不会吞掉状态或把失效作品作为可操作健康作品。
- 真实 Windows Electron 验证：使用隔离数据目录和现有真实 React 组件，通过 `/api/novels` 的本地请求展示作品；最终用户工作台复查只输出脱敏计数、状态和错误类别，证据不保存用户作品标题、正文、路径或 Key。

目前结论：源代码确定存在「单个作品拒绝使整个 GET 失败」边界；真实现场触发条件未核实。等待主代理现场诊断后审核具体方案与用例。

## 第三阶段：具体技术方案审核

主代理随后提供脱敏现场诊断：正式 bootstrap 校验通过，catalog 只有一个已关联作品，目录与 manifest 身份匹配，锁 owner 为本机且其 PID liveness 为 ESRCH。此现场结果由主代理执行；本审核者未重复读取用户目录或操作锁。审阅 `2026-10-10-works-loading-plan.md` 后，按现有源代码核对如下：

- `ContentError(WORK_LEASE_STALE)` 只替代 `workspaces.ts:61` 已完成「同机、合法 PID、ESRCH」检查后的拒绝。保留原错误文字与拒绝行为，对其他错误不给修复资格，分类是最小且合理的修改。它无需跨 RPC 保留 class：列表是在 worker 同一处理过程内捕获后分类，renderer 仅接受有限 reason。
- 逐项汇总保留 strict catalog 读取，健康项仍来自真实数据库而非 catalog 标题。故障项只传 `workId/novelId/title/reason`，不暴露原始异常或文件路径，也不擅自修改目录和锁。全体不可用显示故障卡而非空态，符合诊断结果及数据保护边界。
- 统一 `['novels']` envelope 是必要的关联修改：`ContentTabs.tsx:42`、`ChatPanel.tsx:1076`、`SidebarTree.tsx:1397` 原先三个 observer 对同一 key 各自返回数组，`ChatPanel.tsx:1257` 还直接写数组。只改 Sidebar 会被另一个 observer/refetch/cache update 覆盖故障状态。共享 query 和创建更新同时保留 envelope，且兼容 Web 缺省字段，范围合理。
- 新增按钮只调用已有 `repairWorkLease({type:'start', workId})`，不扩展主进程权限。`desktop/main/index.ts:327` 既有 handler 会验证 UUID、窗口会话、单实例与业务关闭；`work-lease-handoff.ts:100` 之后受控关闭，`:133` 之后原生确认，恢复核心再次核对锁与目录。单次调用和 pending/restarting 保持屏障可复用现有行为。renderer 上次诊断不代替恢复时的复验。

技术方案结论：**批准**。没有阻塞性必须修改项。实施必须保持以下既定验收条件：上游 catalog/global 失败仍失败；只有准确 stale code 获得恢复入口；不可用项不能作为正常作品展开；所有同 key observer 与创建缓存写入一起迁移；原生确认和现有交接流程保持权威。

## 第四阶段：具体测试方案审核

在上述技术批准后，独立审阅同文件 WL-01 至 WL-08：

- WL-02 的真实 PGlite 健康/遗留锁并存与 WL-06 的真实 SidebarTree 故障画面，分别覆盖现场数据链和用户可见回归，应在实现前观察真实失败。
- WL-01/03/04 保持过滤、排序、全体不可用、catalog 拒绝及 live/foreign 锁边界；结合既有 `tests/integration/workspaces.test.ts` 的普通打开不偷锁/缺库不重建，范围针对本次修改。
- WL-05 必须覆盖共同 key 的多 observer 及创建更新，不能只断言单个 helper 返回对象；可以使用真实 React Query 客户端或共享查询的多个消费者，再检查缓存仍含故障项。Tabs 封面摘要须随 envelope 保持正常。
- WL-07 覆盖 start/workId 参数、重复点击去重、取消/错误脱敏与 pending/restarting 状态；原生确认及数据关闭安全性可专项复用既有 handoff/main/pending dialog 测试，不必重复全量应用。
- WL-08 明确隔离的真实 Windows Electron/IPC/PGlite 验证、确认后恢复以及真实字段保持；测试驱动响应原生弹窗须据实说明。用户作品恢复应等待用户在已构建工作台原生弹窗确认，测试证据只保存隔离数据。

测试方案结论：**批准**。没有阻塞性必须修改项。现阶段只批准方案，尚不声明 TDD 实现、测试通过或用户作品已恢复；等待实现差异与执行结果进行代码终审。

## 第五阶段：实现独立 Code Review

审阅文件：`desktop/shared/work-list.ts`、`desktop/service/workspaces.ts` 的 typed stale 拒绝、`desktop/service/dispatcher.ts` 的 GET novels 分支、`src/lib/novel-list.ts`、`src/components/desktop/UnavailableWorks.tsx`，以及真实 SidebarTree/ChatPanel/ContentTabs 的列表读取与创建缓存改动。另读新 integration/browser 专项与既有 workspaces/work-lease 安全测试。保留本工作区已完成的 Tabs 改动，没有修改生产实现或运行用户数据恢复。

### 实现核对

- `dispatcher.ts` 先独立 `await works.list()`，之后 `Promise.allSettled` 只覆盖单个作品 `run`；catalog 异常继续拒绝。worker `start` 的 `runWithGlobal` 保持原状，因此全局收件箱/worker 启动异常不会进入成功 envelope。拒绝项只从已校验的 catalog 取 `workId/novelId/title`，不会输出异常路径和 owner。
- 唯一 typed 拒绝改动位于原同机/合法 PID/ESRCH 判断之后，错误文字保持。列表使用同 worker 域内 `instanceof ContentError && code === 'WORK_LEASE_STALE'`，没有按包含文字、任意 Error 的 code 属性或跨 renderer Error 误判。其他进程、异机、无法确定及通用目录错误均为 unavailable，普通打开仍拒绝。
- `useNovelList` 提供共享 envelope；全部三个真实消费者改用同 hook；唯一生产 `setQueryData(['novels'])` 在 Chat 创建路径调用 `appendCreatedNovel`，保留 unavailableWorks。旧 Web 响应未含 unavailableWorks 时规整为空数组。详情查询 `['novels', id]` 的契约保持独立。
- 不可用项渲染为单独卡片，未复用健康 NovelTree 业务入口；SidebarTree 全故障有故障卡而没有空态。全局查询失败时 `!isError` 隐藏故障入口，保持错误和重试，不借用旧 fault metadata 作为当前恢复诊断。
- `UnavailableWorks` 的 `flight` ref 在调用 bridge 之前同步置位，`busy` 禁用全部修复和重试按钮；只传 `start/workId`。取消返回可重试，异常只显示固定安全文案，pending/restarting 不宣告成功或发起第二次 start。它不改锁/目录，不替代原生确认。原 `DesktopApp.tsx:99` 的 work-lease-pending 事件仍设置 inert 和 pending dialog，`:98` 附近的关闭会话逻辑及主进程交接权限没有放宽。

### 测试覆盖核对与执行边界

- 新集成主用例真实创建两份 PGlite 数据库：健康摘要排序、排除已删除/其他作者、ESRCH stale 锁、部分与全部不可用、catalog/manifest/owner 字节保留、普通打开 typed 拒绝、隔离核心确认后再读原库；另一个用例断言 catalog 异常继续拒绝，raw error 不获得 stale 资格并不泄露详情。
- 新浏览器用例实际渲染 SidebarTree 和 ContentTabs 并共用真实 QueryClient；覆盖健康树业务打开、故障卡、Web 兼容、创建 helper 写入缓存后两个 observer 同步、重试恢复、单次 bridge 调用/参数、取消/安全错误/pending/restarting、无 bridge/通用原因不给修复入口。与真实 Chat 创建调用同 helper 的生产差异已逐行核对；浏览器用例未执行完整 Chat 发送流程。
- live/foreign/uncertain 锁及确认后目录/锁变化由既有 `work-lease-recovery.test.ts`、main/handoff 专项承担；新 WL-04 的 raw error 模拟只验证分类，不能单独声称真实 PID 或文件系统拒绝通过。
- 主代理报告已取得本次红阶段和新浏览器 10/10，集成、既有专项与构建仍在执行。本审核未重复执行测试，尚不代替其命令结果或隔离 Windows Electron 证据。

Code Review 结论：**批准，无阻塞性必须修改项**。没有发现放宽身份/锁验证、静默删除关联、缓存契约冲突或 pending 屏障被绕过。建议将浏览器全局失败用例增加「已载入 fault 后 refetch 失败」的转移断言，让现有用例名称所述旧 metadata 场景得到直接覆盖；当前源实现已用 `!isError` 防止暴露旧恢复入口，该建议不阻塞实现批准。最终验收仍需主代理核对专项命令结果和隔离 Windows Electron。

## 第六阶段：专项终验与证据审核

只读核对 `2026-10-10-works-loading-verification.md`、`docs/evidence/works-loading/target-03/windows-electron.json`、验证驱动和两份台账的 `worksLoadingFix`，并实际查看混合列表、全部不可用、恢复后三张截图。

- 汇总文档记录新增真实数据库 2、新浏览器 11、既有 transport/handoff 23、既有 Tabs/pending 界面 32，合计 **68 项专项用例通过**，并据实保留没有执行全量/完整 Chat 发送/供应商调用的边界。本审核核对主代理执行结果与汇总，不重跑相同测试。此前建议的 partial 后 global refetch 失败已补进真实浏览器用例：确认故障标题和修复入口消失、显示统一查询错误，不输出原始异常。
- target-03 为 `passed`，12 条检查（包括 3 张截图），`errors: []`，Windows Electron 44.6.0。驱动确实设置 offline、assert 零模型与自建隔离 root，走正式 `xaanink://app/` 和本地 API；健康作品仍可选择，全故障显示两张不可用卡且没有空态，目录返回后可重试。
- 验证驱动通过真实 `repairWorkLease(start/workId)` 调用主进程交接，只对合成 fixture 的确认/结果弹窗响应和 relaunch 请求计数做控制；随后 fresh Electron launch 再查两作品和原章节 id/content。它检查关闭事件、锁消失、审计 recovered、catalog/manifest 原字节保持，未绕过实际恢复核心和文件 IO。报告与汇总正确声明这不能等同人工 OS 点击、自然原生 relaunch 或真实用户作品恢复。
- 审核者独立执行只读 SHA256 核验：报告绑定的 **8 个生产源文件、181 个构建文件、3 张截图**全部与当前工作区一致，结果 **mismatches=[]**。此命令没有读取用户目录、正文、Key 或锁 owner。
- 两份台账均为 `scoped-verified-awaiting-user-lock-confirmation`，68/68、nativeChecks=12，真实用户恢复为 `pending-native-confirmation`，完整应用验收保持 `fullAcceptancePassed:false`。范围没有扩张成全应用通过，也没有提前写用户作品解锁成功。

终验结论：**本次实现与隔离数据专项验证通过，无阻塞修改项**。可将当前构建交付用户并保留已有原生锁修复确认；真实作品最终恢复状态仍等待用户确认/反馈，不能由本次合成 fixture 验证代替。

## 第七阶段：实际用户恢复验收补记

用户随后在原生恢复流程完成后明确反馈：**「已恢复，作品能正常展开」**。本段以主代理收到的直接人类反馈为真实工作台恢复依据，不将隔离自动化结果冒充真实用户正文读取。

主代理随后仅执行脱敏只读 metadata 核验，按实际品牌 `b.names` 调用 `observeWorkLeaseAudit`：`registeredWorks=1`、`recoveredAudit=1`、`liveLease=1`，目录/manifest 身份匹配；没有再次打开用户数据库、读取正文或修改文件。本审核核对补充汇总与两台账：状态已正确更新为 `scoped-accepted`，`actualUserRecovery` 为 `user-confirmed-restored-and-expandable`，68 项专项结果及 `fullAcceptancePassed:false` 保持。

结论：**本次作品加载失败修复及实际用户恢复验收完成**。本次补记只更新文档与范围台账，生产源码、测试和构建未改变，无须重复执行已通过测试；不改变其它业务迁移、macOS、安装包或历史全量验收结论。
