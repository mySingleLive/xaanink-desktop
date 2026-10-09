# 窗控重叠与宣纸悬停修复验证

范围：用户报告关闭 X 与方块重叠、宣纸主题原生最小化/最大化 hover 不明显。真实业务组件、原生窗控及纸纹继续复用。没有修改 OS 主题、作者数据或父目录。

## 实现与审核

- 重叠方块为真实 ChatPanel 的 PanelRight 恢复入口。仅在 Windows 且内容隐藏时给原顶栏增加 caption + menu 安全间距；内容展开即释放。菜单使用同样的 env 与 138/zoom 下限，避免缩小后进入原生窗控。
- paper/ink/system 同步 Electron app 的 light/dark/system source，从而让原生 ColorProvider 使用相应悬停反馈。缓存与修订先提交，相同 source 不重复赋值；赋值后重新采样 dark。主窗口及两个冷窗口构造前同步，透明底与原生关闭红底保留。
- 技术方案、测试清单及 code review 已分别独立审核通过，见本轮 plan-review、test-review、code-review。审核不替代原生验证。

## TDD 与关联验证

- tdd-red.log：真实 main 来源同步的 8 个实质失败；初次 browser launch 超时不算产品红灯。
- tdd-cold-red.log：实际维护/定位模块的两个构造前 native source 断言失败。
- tdd-layout-red.log：真实菜单 75% 时进入 caption 区域；tdd-restore-red.log：当前菜单 + git HEAD 真实旧 ChatPanel header，恢复按钮 x1400/w28 位于 caption x1302 右侧。旧源码归一化内容与 HEAD 相同，隔离文件不进入产品。
- 最终 followup-green.log：15 tests / 15 pass / 0 fail；包含真实 header/menu 的 760/1440、五档 zoom、三档字号、侧栏显隐和 env 矩阵，以及主题切换/重入/构造/cold。header fixture 不含完整 DashboardShell 响应式包装，也不证明原生 hover。
- targeted-green.log：72 tests / 70 pass / 2 fail。RW33-01 的旧 preload regex 只接受 `/`，RW33-04 报 RELOCATION_COMMAND_NOT_COMPLETED；没有修改这两个业务断言或相关提交逻辑。
- tsc --noEmit exit 0；npm run build exit 0。本地 Node 24.19.0。

## 全量、包与实机

首次包的真实有 Tab 窗口检查发现 ContentTabs 的全屏/隐藏按钮也进入 caption。按追加技术审核、测试审核、TDD、code review 顺序修复真实 tablist 的 Windows 安全区。`tdd-tab-red.log` 两个实际几何用例失败；`tabs-green.log` 最终 18/18 通过（原空态、ChatPanel、拖动区域及新 WCO-S04/S05）。没有修改原 EMPTY-05 断言。容量不足的受控 pane 只证明右缘安全，不宣称所有按钮完整处于 pane 内；实际工作台结果单列。详见 populated-tabs 两份独立审核。

- 全量 core：245 个文件，1728 tests / 1595 pass / 122 fail / 9 cancelled / 2 skipped，exit 1，约 24 分钟。覆盖最终 main/helper；随后仅追加 renderer tablist 安全区及浏览器用例，未重跑全量 core。全部新主题/构造用例通过。失败包含目录/审计持久化、导出、handoff 等；没有把它们称为已证明的历史基线。`work-lease-handoff.test.ts` 超时后仅结束已核对归属的本轮测试进程树，记录于 `core-file-timeouts.json`；取消与超时并非通过。
- 最终全量 browser：28 个文件，200 tests / 175 pass / 25 fail / 0 cancelled / 0 skipped，exit 1。七个 WCO-S 安全区用例全部通过；失败包含默认剪贴板、导出和部分 controlled 模块缺少 exports。与首次运行计数差异包含导出首次超时及受控模块载入失败，不能据此称未执行子用例通过。最终原始 TAP 与来源哈希见 `browser-full.tap/json`。
- 最终生产构建 `build-final.log` exit 0（Next、TypeScript、静态页面与 desktop build）。原始隔离记录位于 `docs/evidence/window-controls-followup`（git ignored）。

## 最终 Windows 包

`package-final.log` exit 0。Electron 44.6.0，win-x64 NSIS；314 项项目资源与离线依赖检查通过，包内 PGlite 正常关闭。没有发布、签名或安装。

- 产物：`release/XaanInk-0.1.0-win-x64.exe`，276569810 bytes。
- SHA-256：`8979151761cee41f95ea3965f4544c6ada20dc932a8ba310a2e413c507b836e2`。
- 最终 `dist/main/index.cjs` 与包内入口相同：`18ec36822fccddc79d3ec13273c2f01d5256df8d38969a431270a899323e9394`。第一次 followup 包的 main 也是这一哈希；随后只有真实 ContentTabs renderer 安全区改变，第一次包不是最后 renderer 的证明。
- 构建所需的十个原文件临时 LF 归一化在完成后经 `git diff --quiet` 核对为无内容变化，仅恢复这些文件的换行；实际产品/测试改动保留。最终 `git diff --check` 通过。

## 真实目标窗口

使用 Computer Use/Sky 操作本轮隔离的 `release/win-unpacked/玄印写作.exe`；另一个作者开发窗口不参与。Playwright 仅启动、设置 renderer CDP offline、读取主进程和 DOM 几何，不执行 GUI 输入。主题、缩放、窗口菜单、隐藏/恢复及窗控操作由实际 UI 完成。PNG 为原截图；蓝色指针光圈是工具标记，不计为 hover 高亮。

1. 第一次 followup 包通过实际设置 UI 执行宣纸→玄墨→跟随系统→宣纸：app native source 分别 light/dark/system/light，renderer 主题及 native 背景、符号同步。source 只影响应用，没有修改 OS 设置。宣纸最小化/最大化有可见灰色矩形反馈，关闭仍是原生红底 X；对应 `packaged-paper-*-hover.png`、`native-ink-settings.json`、`native-system-settings.json`。本次最终包重新验证宣纸两种 hover，`final-paper-min-hover.png`/`final-paper-max-hover.png`；最大化 hover 同时显示 Windows 原生 Snap Layout 菜单，没有执行全套吸附验收。
2. 最终包 75% 宽窗、有 Tab：viewport 1920，caption 左缘1738，末个内容按钮 right1696，菜单1702..1730，无交集。首次包 `packaged-wide-075-tab.png` 保留为失败基线，不能称为修复后证据。
3. UI 缩窄后实测原生外框 width761；100% 客户区 viewport760。75/100/200% 客户区分别1013/760/380。外框恰好760px未由UI调整达到，记录保留实际值，不宣称精确外框760通过。最终相邻窄窗有 Tab、ChatPanel恢复入口及菜单无二维交集；10 个稳定样本由 `finalize-evidence.mjs` 读取实际 DOM/caption 并校验，结果在 `final-artifacts-and-native.json`。未经稳定刷新、无效/最小化 caption provider 的读数不计入几何结论。
4. 窄窗75%：普通点击进入/退出内容全屏，等待真实 Dashboard 动画，切换按钮文字及实际面板宽度改变；隐藏内容、点击 ChatPanel 原恢复按钮后原主题 Tab保留。200%：实际隐藏内容，原窄窗导航“返回对话”后 ChatPanel恢复入口可见并能点击恢复原 Tab；仅证明执行过的这条路径。100%记录包含真实响应式导航与有 Tab位置；没有补称未执行的每一种空态/字号/侧栏组合。
5. 最终包原生最大化/恢复分别读取 `isMaximized=true/false`；最小化读取 `isMinimized=true`，Sky激活后为false。正常点击原生X经过本地写入等待后窗口退出，驱动exit0；再启动时paper/source light/zoom2/revision7保留，第二次点击X后退出。最大化截图右下有其它应用弹窗，未操作该应用；caption不被遮挡，body不用于业务验收。
6. 首次与第二次启动的 renderer offline 在就绪后启用，只证明离线运行。另做最终 `final-offline-ready` 启动：取得firstWindow后立即设CDP offline，再等待真实应用菜单可见与读取bootstrap，启动就绪成功。该受控条件不等于OS完全断网、NSIS安装或完整业务离线验收。

没有改作者数据/Key，也没有打开HTTP监听服务。隔离夹具记录不进入产品。独立技术、测试与代码审核通过；全量仍有上述失败/取消。多屏/DPI、全部拖动/吸附、非活动窗口悬停、NSIS安装及完整业务未验证，DESK-W03/W04/W05正式状态继续 planned。

最终独立证据复核通过，见 `2026-10-10-window-controls-followup-verification-review.md`；审核重新核对包哈希/尺寸、10个实际样本几何、全量统计和正式状态，未发现本修复范围的阻断结论。
