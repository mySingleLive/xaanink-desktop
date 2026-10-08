# 第101批独立审核：会话关联与本地建书（实施34）

审核者：独立 reviewer，未编写本批生产实现。结论：**PASS（实施34冻结 v1 的源码、原 schema 与实际 worker 范围）**。已发现问题均修复并完成独立复验，没有尚未解决的阻断问题。另已独立核对主代理macOS受控原生补充证据，保存为v2；此结论不替代物理 picker、真实供应商、Windows或531项正式验收。

结论绑定 `docs/evidence/implementation-34/conversation-transfer-frozen-v1.json`，manifest SHA256 `94ef3f8d4ba9aa9a2086ed5cbe6021adc853e914768f9a1ab315bc3b179e250e`。冻结包含57个文件；独立 verifier 在最终检查前后分别核对57/57一致，未重新生成或覆盖作者 freeze。Node统一24.19.0。原暂缓结论所依据的失败日志均保留；本次审结以最终独立证据为准。

本批完整范围是会话权威索引与迁移日志、原 schema 闭包、活跃聊天阶段与数据库租约、原生目录授权、普通关联与历史只读来源、worker 初始化恢复/关闭，以及实际原工具入口。原作者 I01/I02/I03、自测 GREEN 和主代理原生验收分别作为不同证据；不能互相替代。CodeGraph 未在当前工具集暴露，依项目约定定向阅读源码。所有新测试/证据保留，未修改作者原 oracle 或生产实现。

审读覆盖原始 `/api/chat` POST 私有 envelope→真实 begin→exact claim/retry→原工具阶段→target authority→heartbeat/audit/checkpoint/final→release ACK，以及 worker boot inbox 初始化后的 configure/recover/dispatcher 接线。main admission 撤销与物理创建 drain、每个 operation 固定数据库/资产 ALS、transfer copy/verify/commit/CAS/cleanup 顺序、严格 association/history/delete 入口与来源快照均完成核对。正文批准、版本围栏和候选稿仍由原服务校验；新目录 proof 没有变成内容批准。DataRoot、31/33定位模块和35的 root-authority 后续增量不在本结论范围；35未修改冻结57文件，其增量不覆盖本 v1。

## 已确认问题与修复复验

1. **R01 / P1：原窗口撤权后的建书 admission 仍可成功。已修，独立复验 GREEN。** 原 `createWork` 在 chooser 返回 proof 后等待 location/fence IO 再直接创建，撤销 main registry 没有撤销 worker 的独立执行器。独立 RED 记录撤权后 create=1。现 main 私有 admission 的 SharedArrayBuffer seal 会在原 owner/claim 撤销、release、retry 或全部撤销时同步失效；worker 同步 guard 贯穿 Workspaces/createNovelOnce/migration 的异步边界与最后写入，main 跟踪创建物理 flight 到 finish ACK 或已确认 worker exit。R01 原 oracle 仅补新 RPC 转发后通过（create=0）；追加 R04 用实际 Workspaces 方法与真实隔离空目录验证 admission 后撤权、pending IO 不提前 drain、最终目录/catalog 均空。
2. **R02 / P2：失联旧源使已提交目标的会话列表整体失败。已修，独立复验 GREEN。** 原列表对全部工作库 `Promise.all`，即使 location 已提交到可用 target，失联 source 仍中止整个列表。现以 `ledger.locations` 核对权威并用 allSettled 区分失联旧源，当前 authority 失联继续报错，存在未知 legacy 与失联库时拒绝推断。R02 的断言未修改，fixture 仅补新只读 `locations` 方法。
3. **R03 / P1：迁移提交可覆盖别会话的全局实体身份。已修，独立复验 GREEN。** 原 `commitInTransaction` 对 turn/attempt/subagent 索引直接 upsert，可把别库已登记原会话的路由改成新会话。现通过 `writeEntity` 在 inbox CAS 同一事务校验完整既有指针，跨会话 entity advisory lock 按稳定顺序获取；冲突整体回滚 location/journal/index。R03 原 oracle 不变通过。
4. **R05 / P1：原会话 DELETE 缺少持久 tombstone，成功删除会破坏列表。已修，独立复验 GREEN。** 原 DELETE 只删 row，严格列表随后永久报 authority unavailable。现删除经 phase gate 与精确 CAS，inbox 行删除/tombstone 同事务，作品库先提交 tombstone/deletion journal 再物理清理，未完成返回409并按原 journal 重试；其它请求404，不重新扫描旧copy。R05 actual handler 原 oracle 不变通过。
5. **R06 / P1：ready 已写入而 catalog 登记失败时，重启后同请求改选另一目录可能创建第二部作品。已修，独立原 schema 回归 GREEN。** 原全局查重只读 catalog，未登记 ready 结果不在其内；同 operationId 新授权能选择另一空目录。新增 inbox 私有 creation reservation 在目标首次写入前绑定原 requestId、原 Workspaces requestHash 及 native directory identity，原 catalog 失败保留 pending；异目录/内容/身份冲突拒绝，原目录必须获得新 native 授权才可恢复。reviewer I02 真实注入 ready 后登记失败，关闭重开后异目录拒绝且空、原目录恢复同一个 workspace/novelId 与原幂等回执。作者在 PG 窗口到达前已落地接线，故此项仅记源码缺陷审读和修复后回归，不声称 reviewer 行为 RED。作者 RED62 是新 helper 缺模块的 TDD 启动失败，另列为作者证据。

## 独立证据

| 文件 | 结果与含义 |
| --- | --- |
| `tests/unit/conversation-transfer-101-review.test.ts` | reviewer 自写 adverse oracle，针对实际 registry/runtime host、dispatcher、ledger；未替换原测试 |
| `docs/evidence/implementation-34/review101-01-window-create-red.tap` | 环境错误：系统 Node20 没有 `Promise.withResolvers`，**不算行为 RED** |
| `docs/evidence/implementation-34/review101-02-window-create-behavior-red.tap` | Node24.18.0 首次 R01 行为 RED |
| `docs/evidence/implementation-34/review101-03-window-create-behavior-red.tap` | R01 行为 RED，诊断保留撤权后实际 create=1 |
| `docs/evidence/implementation-34/review101-04-source-list-red.tap` | R02 行为 RED |
| `docs/evidence/implementation-34/review101-05-related-pure.tap` | 未冻结相关测试：57 个，54 PASS；作者正在新增的 recovery T05-T07 因方法未实现失败，不能算冻结验收 |
| `docs/evidence/implementation-34/review101-06-entity-collision-red.tap` | R03 行为 RED |
| `docs/evidence/implementation-34/review101-07-source-list-entity-green.tap` | R02/R03 独立修复复验，2/2 PASS；未冻结，不能替代最终验收 |
| `docs/evidence/implementation-34/review101-08-window-admission-green-attempt.tap` | R01/R02/R03 独立复验3/3 PASS，统一 Node24.19 |
| `docs/evidence/implementation-34/review101-09-admitted-physical-green.tap` | 新 R04 实际 Workspaces.create 的受控物理 IO/空目录/drain 检查 PASS；该追加回归没有声称既往 RED |
| `docs/evidence/implementation-34/review101-10-types-attempt.txt` | 未冻结类型尝试：review mock 参数隐式 any 与作者 baseURL 拼写；review 仅补类型注解，作者待修自身字段 |
| `docs/evidence/implementation-34/review101-11-delete-index-red.tap` | R05 actual DELETE→list 行为 RED |
| `docs/evidence/implementation-34/review101-12-delete-index-green-attempt.tap` | R05 同原 oracle actual handler 独立修复复验 PASS |
| `docs/evidence/implementation-34/review101-13-original-schema-attempt.tap` | reviewer 自写真实 Workspaces 三库 A→B→inbox、历史七表、旧候选跨作拒绝、失联源重开、只读历史与连接关闭；4/4 PASS，无模型/chooser调用 |
| `docs/evidence/implementation-34/review101-14-types-reservation-attempt.txt` | 新 I02 与 reservation 接线后的未冻结全量类型检查，退出0；空日志表示没有诊断 |
| `docs/evidence/implementation-34/review101-15-creation-reservation-postfix.tap` | reviewer I02 修复后原 schema 回归1/1 PASS，所有连接实际关闭，PG窗口已释放 |
| `docs/evidence/implementation-34/review101-16-freeze-before.json` | 独立核对冻结前57/57文件哈希及字节数一致，manifest SHA绑定上述v1 |
| `docs/evidence/implementation-34/review101-17-final-pure.tap` | 冻结后独立相关pure、main/原handler 生命周期与reviewer adversarial oracle，118/118 PASS；不将重叠用例数量相加 |
| `docs/evidence/implementation-34/review101-18-final-types.txt` | 冻结后全量 `tsc --noEmit`，退出0，0字节诊断 |
| `docs/evidence/implementation-34/review101-19-final-original-schema-worker.tap` | 冻结后真实原schema+reviewer三库/未知结果+原作者工具/审计/失败恢复+actual builtworker，15/15 PASS，串行23.1秒；所有连接及worker实际关闭 |
| `docs/evidence/implementation-34/review101-20-freeze-after.json` | 最终检查后57/57文件哈希及字节数仍一致，没有在测试中换实现或修改oracle |
| `docs/evidence/implementation-34/review101-21-native-verification.json` | 独立只读核对主代理script/build输入/JSON/三图；v1仍57/57一致，原生记录的11个源码/产物输入均与实际文件相符 |

## 最终检查与实际边界

最终PG组执行 `tests/integration/conversation-transfer-101-review.test.ts`、原 `conversation-transfer.test.ts` 与 `conversation-worker-lifecycle.test.ts`，统一 `--test-concurrency=1`，与35及原生验收协调独占窗口。真实原 SQL 验证完整可执行图精确 ID/时间/JSON/epoch，目标实际行重放校验、inert模型引用的稳定身份/可编辑metadata、历史七表原费率与未采用候选留源、原候选跨作品拒绝、A→B→inbox 后失联A仍保持当前authority、未知ready创建结果严格恢复。同轮原start工具的started/finish audit、后续工具、heartbeat与末尾落库，以及精确失败审计/owned journal恢复均复跑通过；新增inbox预留没有造成同引擎自等待。

实际 builtworker 在原 begin 后收到私有 origin、分离执行器在最终claim ACK前保持active，HTTP follower取消不会提前结算，真实详情重新读取终态、旧严格普通 envelope拒绝renderer origin注入。该无模型场景的 `MODEL_NOT_SELECTED` 是用例预期终态，TAP用例及套件都通过，不把诊断日志误记为失败或声称模型调用通过。检查已收到所有worker和连接关闭完成，随后将PG窗口释放给根代理。

审核期间没有真实模型/付费服务调用。reviewer 自写R01/R04与三库场景分别采用受控native transport、真实隔离文件系统和原schema/PGlite；最终还独立执行了原作者actual工具和builtworker用例。物理macOS picker、Windows、531正式用例未执行，不标为真实通过。未新增普通关联的原Web UI交互；本批提供原IPC详情PATCH的严格association命令，符合已冻结合同范围。

## v2：主代理macOS原生开发证据的独立核对

本段为只读证据审核，reviewer没有再次运行Electron。原材料为 `root-native-18.txt` 和 `native-attempt-LfQ1Ew/` 中的 `build-inputs.json`、`native-conversation-transfer.json`、cancelled/created/reopened三张真实截图；开发script为 `scripts/smoke-conversation-transfer.mjs`。`conversation-transfer-frozen-v2.json` 在保留v1的基础上绑定script、真实运行证据及独立核对记录，不替换原冻结、不提升35源码范围。

实际darwin/arm64原Electron/Web composer/main-worker/原schema与文件系统三组检查完成，JSON `passed=true`、errors为空。取消图保留用户原消息、未选目录说明及原聊天；创建图显示新作品和原start/规划工具完成；重开图显示同会话/工具记录以及“冷启动保留的未提交输入”。script还核对取消前后catalog/空目录不变、只增加一部作品、同attempt的真实工具与终态、重启后消息精确相等且本机模型HTTP请求数量不增加。`await app.close()`之后才launch新App；定向阅读已安装Playwright可见close等待Electron Close，该事件由实际进程onExit发行，因此不是仅重开窗口。

首轮 `root-native-17.txt`、`native-attempt-pYVFme/failure.json` 和原失败截图保留：夹具custom模型未配置capacity，原安全上下文规则实际给出 `CONTEXT_SAFETY_BUDGET`，script因等不到期望文字而超时。第二轮在新隔离目录，通过实际设置UI的高级配置填1M后通过；没有改生产、断言或绕过安全预算。它是实际夹具配置失败及修正，不称为已修复生产缺陷。

独立核对时v1的57文件仍一致，成功运行记录的11个source/compiled/UI输入hash都与当前实际文件一致。I04的desktop编译可能包含第35批尚未冻结的shared `root-authority`增量；原生记录绑定实际dist产物，但这不授予35依赖源码PASS，也不把它加入34的源码结论。所有正式范围仍分开：本机HTTP模型为fixture，`dialog.showOpenDialog`为controlled选择器，未证明真实供应商/物理系统picker/Windows安装/531正式用例。
