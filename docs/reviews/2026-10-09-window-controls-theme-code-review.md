# Windows 窗控主题实现独立 code review

日期：2026-10-09。审核范围仅为 `desktop/main/window-appearance.ts`、`desktop/main/index.ts`、`desktop/main/root-maintenance-window.ts`、`desktop/main/root-relocation-window.ts`、`tests/unit/window-appearance.test.ts`，参照已通过方案和测试清单。**初次结论：需修正 1 个 P2 启动事件竞态后复审。** 未修改实现或测试。

## 待修正问题

### [P2] 在首屏加载之前订阅系统主题变化

当前 `index.ts:302` 先 `await createWindow()`，到 `:311–314` 才注册 `nativeTheme.on("updated")`。`createWindow()` 在 `:663–664` 构造外观，`:696` 再应用当前系统值，随后 `:699` 异步等待 `loadURL`。如果系统色在这个加载阶段改变，则没有监听器为原生 caption 更新符号；此时 `desktop:bootstrap` 在 `:468` 返回新 `systemDark`，React 可采用新主题而原生符号仍保留旧主题，直到下一个主题事件或保存。跟随系统启动因此仍可能产生本次要修复的主题不一致。

建议在 `await createWindow()` 前注册现有 updated listener，或者确保注册后立即重新同步一次以补上加载期变化。增加注册时序的回归；现有 AST harness 直接执行回调，只验证回调内容，无法发现漏掉整个启动事件的问题。

## 其余核查结果

- helper 使用 `#00000000` 的全透明色、真实 background/foreground 常量和 44px 原生高度；`applyWindowAppearance` 判空和 `isDestroyed()` 后才调用 setter，只有 win32 调 overlay，保留其他平台原生控制方式。
- 实际 `send` 的 state 分支 `index.ts:107–109` 进入实际 `refreshMenus`；设置及配置导入仍在持久化成功后发送 state。revision 比较保留 `<`，同 revision 的新窗口可重新应用，旧 revision 不更新选择值。`windowTheme` 保存 paper/ink/system，系统事件使用当次值，无窗口时也保留提交选择。
- 主窗 constructor 使用本次 repository read 的选择值。维修/重定位 constructor 共享 helper，仍沿用既有有效主题快照，未添加可能与静态 body 分离的系统订阅，也未改变 runner/controller 的业务生命周期。
- AST harness 提取并执行实际 `send`、`refreshMenus`、`applyMainWindowAppearance` 和 nativeTheme callback，未加载 main 启动或作者 I/O；helper 另有真实导入与 setter 测试。constructor 测试执行真实 options AST，但依赖注入的 nativeAppearance；这是构造接入验证，不是 native 渲染验证。
- 改动限于主进程外观同步，没有修改 Web React 业务组件、设计预览或 CSS 布局，没有新增 IPC、HTTP 或数据访问。

## 独立运行与红灯证据

独立执行 `node --import tsx --test tests/unit/window-appearance.test.ts`：初次沙箱 `spawn EPERM`；获工具升级执行后 exit 0，**11 tests / 11 pass / 0 fail / 0 skipped**。这只是单元与 AST mock 验证，不能标为真实 Windows 原生通过。

已读取 `docs/evidence/window-controls-theme/red.tap`、`red-host.tap` 与 `green.tap`。首份 red 的三个 host 项因 harness ASI 解析问题失败，不能算产品回归证据；三个旧 constructor 项实际因 `#faf5e8` 不等于透明色而失败，构成有效旧行为红灯。修正后的 red-host 三个项实际因旧 main 缺少外观同步调用而失败；另用 `git show HEAD:desktop/main/index.ts` 与 baseline-main.ts 归一化换行比较，`BaselineEqualsHEAD=True`。当前 green 的 11/11 与独立复跑一致。

全量、构建及真实 Windows 原生验证尚由父代理继续执行。本记录不声明其通过。

## 启动竞态修复复审

同日复审结论：**上述 P2 已修复，当前实现 code review 通过；没有未解决的实现问题。**

已核对最新 diff：`launch()` 在 `await createWindow()` 之前注册 `nativeTheme updated`，因此首次 `loadURL` 期间的主题事件可同步原生外观。窗口尚未创建的事件仍由 helper 判空处理，constructor 随后读取真实已提交选择与当次系统值，保留既有初始化和关闭逻辑。

新增 WTHEME-05 启动回归按实际 `launch` AST 的语句顺序执行订阅和创建语句，在创建 stub 内触发系统变化并核对已注册 listener 和外观同步。读取 `red-startup.tap`：旧顺序实际失败于 listener 为 undefined，不是 harness 解析失败；读取当前 green 并独立重新执行 `node --import tsx --test tests/unit/window-appearance.test.ts`，exit 0，**12 tests / 12 pass / 0 fail / 0 skipped**。

本复审只确认修改与单元回归。父代理报告的首次全量测试总超时/单项超时尚待降低并发后完整重跑，不能视为通过；构建、打包及真实 Windows 主题/窗控验收仍须保留实际结果和范围。

## 全量失败只读诊断与原生验证限制

同日只读检查 `docs/evidence/window-controls-theme/core-complete.tap` 的当前快照：BDC05 legacy 与 current 两项真实失败，均为 `AUDIT_DURABILITY_UNCONFIRMED`，堆栈指向 `desktop/core/work-lease-recovery.ts:38`、`:219`。读取时日志尚无完整 TAP 结尾统计，因此不据此给出最终总计或全量通过结论。

源文件诊断：BDC05 在 `tests/integration/brand-data-compatibility.test.ts:204–207` 直接创建 `WorkLeaseRecovery` 并恢复隔离夹具中的过期作品锁，未运行本次改变的主窗口或原生主题接口。`recover()` 将内部错误安全化；`syncAudit()`（`work-lease-recovery.ts:226`）及 `writeAudit()`（`:249`）会将不能确认审计耐久性的失败映射为该错误。目录 sync 的 Windows 豁免仅限明确 unsupported code，普通 I/O/close 失败会保留为未确认；日志没有原始 syscall code，不能据此断言具体是权限、文件系统或其他单一根因。

执行 `git diff HEAD -- desktop/core/work-lease-recovery.ts desktop/core/brand-names.ts desktop/shared/brand-names.ts tests/integration/brand-data-compatibility.test.ts` 为空；逐文件读取与 `git show HEAD:<path>` 归一化换行比较，四个 `EqualsHEAD` 均为 True。结合测试直接调用链，判断该失败与本次窗控改动无直接关联。**它仍然是未解决的全量验证失败，不能因此忽略、跳过或记为通过。** 未修复该无关实现，未修改任何测试或跳过用例。

本次原生 UI 验证已因用户物理 Escape 停止 Computer Use，后续未发送原生 UI 输入。只读查看已保存 `docs/evidence/window-controls-theme/native-paper.png`，可见真实 Windows 最小化/最大化/关闭组，宣纸背景与相邻顶部纹理连贯，支持该截图状态下的透明背景结论。深色、hover、右栏/Tab 布局切换、系统色切换及跨进程原生启动验收未执行，不能从单张截图或 12 项 mock 回归推定通过。父代理将继续完成非 UI 全量与打包结果并保留这些限制。

## 其他全量失败继续只读诊断

再次读取两个日志快照，未进行任何原生 UI 操作，未修改实现、测试或用例选择。core 仍在追加输出，没有最终 footer；browser.tap 已出现 `199 tests / 174 pass / 25 fail / 0 skipped` 的 footer，但运行进程退出由父代理核实，本诊断不把仍运行的全量统计称为最终验收。

### 两个文件级加载失败

`configuration-files-review.test.ts` 与 `conversation-chat-lifecycle.test.ts` 的文件级失败均紧跟 esbuild 的 `ensureServiceIsRunning` / `startSyncServiceWorker` → `ChildProcess.spawn` → `EPERM`，`name: TransformError`，Node v24.19.0。该栈位于 TS/transform 服务初始化，尚未进入用例断言；日志不存在 window-appearance 的模块解析错误、缺失符号或 `ReferenceError`。不能将其当成本次 helper 导入或真实外观 setter 抛错。

调用链检查：`tests/helpers/main-function.ts` 只读解析 main 并提取 `businessHandle`；配置审核再按需提取 `trusted`、`registerIpc` 等函数，未 import/执行整个 main 的启动与原生主题监听。对话生命周期测试直接使用 `ConversationTaskRuntime`，并在 VM 中转译执行 `desktop/handlers/chat/route.ts`，同样不进入主窗口外观代码。以上两个测试、main-function helper，以及 ConfigurationFiles、ModelRepository、BusinessGate、ApplicationMetadataGate、ConversationDirectoryAuthorizations、ConversationTaskRuntime、chat route，与 `git show HEAD:<path>` 归一化比较全部相同。**没有发现这两项加载失败由本次窗控改动引起的证据；仅凭 EPERM 不能再断言具体限制来源。**

### 其余错误与本次改动的关系

- core 的冷源保存失败指向 `application-cold-source.ts` 的 capture/walk，包含 `APPLICATION_COLD_SOURCE_UNREADABLE`、超时或相应断言失败；该实现与 AC36/AR104 测试与 HEAD 相同。AR105-G02 的子进程日志明确为 `ERR_UNSUPPORTED_ESM_URL_SCHEME`，收到协议 `d:`，对应未修改测试把 Windows 路径直接写入 ESM import 的脚本。没有经过窗控代码。
- core 的导出失败包括 `EXPORT_DURABILITY_UNCONFIRMED`、`failed !== saved` 等；FileExports 及导出测试与 HEAD 相同。EXP83-07 虽提取真实 main 的 `releaseOwner`，但其源码片段与 HEAD 精确一致，且 fixture 只注入导出/授权依赖，未调用新增外观代码。另见草稿权限断言 `438 !== 384` 与 avatar 预期拒绝未发生；DraftJournal、AvatarAssetService 及对应测试也与 HEAD 相同。上述安全化错误未保留原始 I/O 原因，不在此推断单一根因。
- browser 的 lease UI 组实际在 esbuild 打包时失败：controlled react-query mock 仅导出 useQueryClient，缺少真实 PromptsClient 已要求的 useQuery/useMutation；controlled command-runtime mock 仅导出 setDesktopCatalogStatus，缺少 ConfigurationTransfer/DesktopCommandController 已要求的 desktopCommandCatalog/desktopCommandTargets 等。mock 测试和这些组件均与 HEAD 相同；browser bundle 不 import Electron main 或 window-appearance，因此这些导出不匹配不由本次窗控导入引起。
- browser 另有 2 项 API Key 编辑/undo 断言失败、4 项导出保存未确认、1 项定位页面 heading 等待超时。检查的实际 Controller、input/native-text 编辑模块、shortcut/runtime、export bridge、Home 及这些 browser 测试与 HEAD 归一化相同，调用链不进入原生外观更新。现有日志只证明相应失败；未在 HEAD 另跑这些用例，因此不声称已证明历史上何时开始失败，也不推断未记录的时间、浏览器或系统原因。

以上比较采用只读 `Get-Content` 与 `git show HEAD:<path>`，归一化 CRLF 后 `EqualsHEAD=True`；main 的 releaseOwner 片段另有 `ReleaseOwnerFound=True`、`ReleaseOwnerEqualsHEAD=True`。目前没有发现新增 window-appearance 导入/同步调用导致上述失败的直接调用链，**全部观察到的失败仍保留为失败，不能据此宣布全量通过。**

## 定向复跑与有限验收记录复核

同日只读核实 `load-failure-rerun.tap`：18 项 CF61 配置审核与 3 项 CHAT34 生命周期用例全部通过，footer 为 **21 tests / 21 pass / 0 fail / 0 cancelled / 0 skipped**；父代理确认该单并发复跑进程 exit 0。这证明这些用例在本次单独复跑可成功加载和执行，不能覆盖首次全量的两个 esbuild 文件加载失败，也不能将首次运行或整体 core 状态改为通过。

父代理确认 browser 进程 exit 1；其实际 footer 为 **199 tests / 174 pass / 25 fail / 0 cancelled / 0 skipped**。`core-hung-files.json` 分别记录 inbox-lease-window-116-review 的 309 秒、root-relocation-review 的 224 秒以及对应 pid/parentPid/file，结果明确为超时、停止、失败/不完整，没有写成跳过或通过。core 日志确已记录 inbox 文件被结束的失败，其他文件继续运行；读取时仍无最终 footer，不能把当前进度作为最终计数。

已读取 `docs/reviews/2026-10-09-window-controls-theme-verification.md` 与 requirements W03：前者将新增回归、构建/资源探针、单次 paper 原生截图及未执行范围分别说明，未作全量/安装包原生通过声明；W03 正式 `status=planned`、正式 `evidence=[]`，开发状态仅 `in-progress`，有限范围表述准确。建议验证记录补写此次 21 项定向复跑，同时继续保留首次加载失败，并在 core 结束后追加实际最终统计；无需改变其他验收条目。

只读复核 package 日志和产物：314 项包资源核对、PGlite 已关闭记录存在；dist 与解包资源 main SHA256 均为 `3AF5100F144DA4BDDCC7D32B4860EB64A07A5059EE525E56C3B68DE4F27316A9`，安装包为 276569769 bytes、SHA256 `A713F40BEE5F7A8BAD77015F1D36CCE0E6822DB52462A22DCF534ECDC02FA3B8`，与验证记录一致。`native-paper.json` 的 unpackaged、paper/revision 1、systemDark true、非最大化、右栏隐藏、0 Tab 和背景 `#F4EDDA` 也与其单张截图范围一致。没有进行任何原生 UI 操作，未扩大验收声明。

## 完整日志后的 main AST harness 关联检查

完整 core 日志后来出现 M71-10 `nativeWindowAppearance is not defined`。**这项不能归入此前诊断的无关基线失败：本次 createWindow 增加了 helper 依赖，而旧测试只抽取函数 AST，未把 main 的真实 import 自动注入 evaluator。** 产品 main 已有真实导入与构建接入；遗漏发生在测试依赖列表。

已独立审核 `tests/unit/root-maintenance-main-review.test.ts` 的补充 diff：仅新增真实 `nativeWindowAppearance` import，并向 `reopenRig` evaluator 注入该函数，没有改断言、mock 出预期外观或改产品代码。`main-harness-rerun.tap` 为 **11 tests / 11 pass / 0 fail / 0 cancelled / 0 skipped**。独立按 Node 24.19.0 的标准 `--import tsx --test --test-reporter=tap` 命令复跑，exit 0，同为 11/11，通过此次 harness 适配复审；原全量 M71-10 失败仍保留，不被复跑覆盖。

独立复跑期间也核实 PATH 中系统 Node 为 20.12.2，该版本缺少现有测试使用的 Promise.withResolvers；直接调用 bundled exe 的子进程重启亦曾产生执行器路径解析错误。调整执行环境以明确 Node 24 后标准测试通过，以上执行环境尝试不解释为产品或新 helper 缺陷。

辅助窗口测试实际 esbuild bundle 各自 entry point，helper 已随 bundle 进入执行。W71-01、RW33-01 的当前可见失败分别是 `/preload\/maintenance\.cjs$/`、`/preload\/root-relocation.cjs$/` 匹配 Windows 反斜杠路径失败，没有显示 helper 未定义。只读还发现 W71-01 下一行 `root-maintenance-window-review.test.ts:66` 仍期望旧 card 底色 `#faf5e8`，与本次批准的真实 background `#f4edda` 契约不同；该断言在当前运行中被前面的路径断言阻挡，**属于潜在的关联旧预期，不能冒充当前日志已到达的错误**。已通知父代理，未修改该测试或 preload 路径用例。

## 最终 core 统计核实

父代理确认 core 进程 exit 1，独立读取 footer 为 **1678 tests / 1558 pass / 117 fail / 1 cancelled / 2 skipped**。`1..1648` 是顶层条目数，不能代替包含子测试的 footer。挂起记录现有四个独立文件，时长分别为 309、224、204、264 秒，全都保留为失败/不完整。最终全量没有通过，不能把 117 项统称为无关基线或用定向通过覆盖。

原生验收仍仅限已记录的单次 paper 截图，用户中止后的未执行项目保持未执行。W03 的 planned 和有限开发范围结论保持有效；正式 verification 应补入最终 core 统计、M71 harness 适配及独立定向复跑结果。

## W71 受控窗口测试适配复审

已独立审核 `tests/unit/root-maintenance-window-review.test.ts` 的两处 diff，结论：**通过。** W71-01 的启动 background 预期由旧 card `#faf5e8` 改为已批准的真实 background `#f4edda`，解决上一节发现的潜在旧预期；preload suffix regex 仅将目录分隔符 `/` 改为 `[\\/]`，仍要求 `preload` 目录、精确 `maintenance.cjs` 文件名与字符串末尾，没有放宽为任意路径或跳过检查。这使真实 Windows 的 join 路径可继续执行同一用例中的颜色、原数据字节、隔离会话及关闭边界断言。

读取 `maintenance-window-rerun.tap` 为 **6 tests / 6 pass / 0 fail / 0 cancelled / 0 skipped**，父代理确认 exit 0；独立使用 Node 24.19.0 标准测试命令复跑也为 exit 0、6/6。源码仅适配上述两个预期，未改变 runner/controller、业务实现或其他断言；`root-relocation-window.test.ts` 与 HEAD 归一化比较仍为 `RW33EqualsHEAD=True`，未修改 RW33 用例。

这些都是 esbuild bundle 配合受控 Electron 窗口的单元测试结果，不能声明真实原生窗口验收通过。原 core 的 W71-01 失败、其他失败与最终 1678 项统计全部保留；本次定向 6/6 不覆盖首次全量，也不改正式 W03 planned 状态。未进行任何原生 UI 操作或扩大用例范围。
