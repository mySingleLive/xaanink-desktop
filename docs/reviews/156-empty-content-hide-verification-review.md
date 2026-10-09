# 空右侧内容面板收起按钮最终证据独立复查

2026-10-09（Asia/Shanghai）。本代理只读核对155验证说明、implementation-47的最终/失败日志、verification.json、原生报告和截图、两处台账diff，并用只读SHA-256/JSON比较核对当前文件。未重跑测试、启动UI、执行鼠标点击或修改产品；本轮只新增本审核文件。

结论：**本轮有限开发修复的最终证据审核通过，未发现未解决的不一致。** 结论涵盖当前源构建、macOS开发Electron实际验证及Windows浏览器布局合同；Windows原生/DPI和当前安装包未执行，不能据此声称跨平台安装版全部验收完成。

## 最终日志及数量

- `core.log`完整终态：1624通过，0失败/取消/跳过；`browser.log`完整终态：193通过，0失败/取消/跳过。两者合计1817，与155/verification.json一致；未重复加入聚焦22例和native检查。
- `green.log`完整终态22/22通过。`red.log`完整终态0通过/8失败，8次失败都包含实际可访问空态隐藏按钮缺失的断言，符合RED边界。
- `typecheck.log`无错误；`build-ui.log`记录成功编译/TypeScript/静态页面生成；`build-desktop.log`记录桌面构建命令完成。verification.json和主代理命令结果记录三者exit0。本代理读取这些证据，没有把读取日志命令的exit0误记为测试或构建退出状态。
- 当前`native.log`记录HxoaaD独立运行的gate及最终“Actual macOS empty content hide acceptance passed.”，当前原生JSON为status passed、22 checks、errors=[]，verification.json记录native exit0。

## 当前文件与原生证据关联

1. 对verification.json列出的**1247项fingerprints逐项重新读取并计算SHA-256，缺失0项、不匹配0项**。它们关联当前源码、测试及构建文件；不是用文件名或旧运行结果推断当前验证。
2. 当前原生报告的**7项sourceHashes全部匹配当前源文件**，包含产品布局、完整DesktopApp、Electron主进程、最新harness与seed helper。
3. 当前成功原生报告位于独立证据目录 `docs/evidence/implementation-47/xaanink-empty-hide-HxoaaD/empty-content-hide-native.json`。重算SHA-256为 `40241c55a96740687a37a8fe3b275c82d41cdaeb69ffefae9728003efa5e4da7`，与verification.json的reportHash一致；根目录成功alias与该独立报告字节完全一致。
4. 当前报告引用的独立目录`default-empty-native.png`哈希匹配。本代理实际查看该图，空右区顶行右侧可见PanelRight图标，侧栏明确没有小说，原空态正文仍在；没有把renderer图当作原生截图。系统鼠标选择独立bundle和AX38点击由主代理执行，本审核按其CUA操作记录摘要、该原生图和随后harness卸载断言交叉核对，没有另行操作UI。
5. 重新解析当前native报告，14条布局记录均满足按钮包含在右区/顶行、header y=0、零Tab、随rem字号变化的右距，以及header drag/button no-drag；7条收起记录均确认内容卸载且AI恢复入口可见。完整报告包含系统鼠标、Enter/Space、10组native zoom/font、重启后AI恢复和最后Tab自动收起后的空态恢复。window状态比较由真实Electron harness断言，源码没有以组件mock替代。

## 失败记录及证据稳定性

首次typecheck类型收窄失败、首次browser并行构建造成的167通过/4失败、初次CUA路径选择歧义及初次重启旧预期超时均保留，155明确说明原因和修正，没有当作最终通过。

本独立复查过程中确实发现旧gate宿主10分钟后超时finally把共享原生alias覆盖为failed/1 check，与当时summary的passed/22 checks冲突，立即报告主代理并暂停通过结论。当前`native-initial-selection-timeout.json`保留这一真实failed及“Native CUA gate timed out”；没有从记忆重建成功报告。主代理修正harness为每次mkdtemp对应独立repo证据目录，失败仅写本轮文件，只有passed才更新alias，并完整实际重跑。当前独立成功报告/hash/alias已重新核对一致，解决该冲突。

初次重启failed报告的原生图另存`initial-restart-failure-native.png`，重算仍匹配该报告原screenshotHash，失败图未被最终图冒名替代。重启新预期保留既有draft-recovery零Tab收起策略，再经真实AI入口打开/收起空面板，未修改该产品恢复行为。

## 台账边界及未执行项

逐项JSON比较HEAD与当前两处台账：requirements-traceability仅为W05追加ContentTabs实现路径、EMPTY-01–07 testIds及development.emptyContentHide记录；W05 status仍为planned，既有业务/验收状态未改变。migration-map仅新增顶层emptyContentHide，所有原有条目保持完全相同。新记录明确限定macOS-development-and-windows-layout-contract-verified。

155及verification.json均正确保留Windows原生/DPI、重新打包/安装/发布、全系统断网、窄屏完整工作台/多屏/IME未执行边界。Windows45组fallback和48组env读取注入验证的是真实浏览器几何合同，不能替代Windows原生窗控验收；原生窗口本轮为2200×1000，keyboard使用Electron/CDP注入，不冒称硬件键盘。上述边界与当前最终证据一致。
