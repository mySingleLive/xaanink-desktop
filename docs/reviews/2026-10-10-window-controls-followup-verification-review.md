# 窗控修复最终证据独立复核

日期：2026-10-10。结论：**有限范围证据表述通过，未发现需阻断本轮结论的问题。全量测试仍失败，W03/W04/W05正式验收并未完成。** 本次只新增本审核记录；没有修改产品、测试、台账或其他审核，没有执行UI或重新运行原生操作。

## 复核依据

完整读取本轮 followup-verification，核对 requirements-traceability 中W03/W04/W05新增开发记录；读取 final-artifacts-and-native、其10个geometry样本对应的 `native-<id>.json`、原生最大化/复原/最小化/恢复、重启及offline-ready记录。检查build-final/package-final、core-full/browser-full的JSON totals与原始TAP footer、tabs-green最终footer。只读查看已有最终两张paper hover图片；蓝色指针标记不作为hover本身的证据。对实际产物重新计算文件大小及SHA-256，没有运行finalize脚本或写入原证据。

## 产物及来源

- 实际 `release/XaanInk-0.1.0-win-x64.exe` 为 **276569810 bytes**，SHA-256为 **8979151761cee41f95ea3965f4544c6ada20dc932a8ba310a2e413c507b836e2**，与验证记录、最终metadata完全一致。
- 实际 `dist/main/index.cjs` 与 `release/win-unpacked/resources/app/dist/main/index.cjs` 均为 **18ec36822fccddc79d3ec13273c2f01d5256df8d38969a431270a899323e9394**。同main哈希不能证明renderer相同；文档正确保留首次有Tab截图为失败基线，使用最终native有Tab样本证明追加修复。
- build-final日志显示Next编译、TypeScript、静态页与desktop build完成；package-final显示Electron44.6.0/win-x64/NSIS产物、314项项目资源检查和PGlite正常关闭，publish=never/signing disabled。文档没有将资源检查说成NSIS安装或完整业务验收。
- core-full的main、helper及两个cold模块source哈希仍与当前文件一致；其ContentTabs和empty-content-hide哈希与当前不同，符合“core完成后只追加renderer/浏览器用例，未重跑core”的明确说明。最终browser-full中这些文件哈希均与当前一致。两次运行的覆盖边界没有合并成一次全通过。

## 原生有限结论

独立重算10个稳定样本的caption右侧保留矩形与每个控制按钮、固定菜单的二维交集，结果均为 **0**；样本均packaged=true、caption宽度有效、minimized=false。不是直接采用finalize脚本写死的汇总值。最终宽窗75%样本的viewport1920、caption right1738、内容末按钮right1696、menu1702..1730与正文一致。

窄窗记录的原生外框width为 **761**；100% viewport为 **760**，75%/200%分别1013/380。文件id中的“760”没有被正文当作实际外框宽度，验证记录与台账均明确未达到精确外框760。100%内容按钮y约56.67..80.67，caption为y0..44，真实响应式纵向位置有记录；不以仅横向计算冒充全部导航组合。

实际原生状态JSON分别记录maximized=true/false、minimized=true/false；重启样本记录paper、source light、zoom2、revision7及有Tab。全屏样本包含“退出全屏”真实按钮标签，隐藏/恢复和窄窗路径的正文限制与样本一致。本审核只复核已有状态、图片和主代理操作记录，没有独立重复鼠标操作；metadata中nativeOperations汇总布尔值不能脱离这些原始记录单独证明操作。

首次包ink/system设置记录分别为dark/system source，renderer classes为ink且背景#0D0B0A；文档明确该主题序列来自首次包，最终包另复验paper hover及修复后的tablist。未用旧renderer截图证明最终Tab修复。最终paper图片存在且caption/反馈区域可见，Snap Layout菜单仅记录出现，未提升为全套吸附验收；非活动hover、多屏/DPI、全部拖动/吸附和NSIS安装仍未验证。

极窄受控pane保留“只证明右缘安全”的限制，不宣称全部按钮完整位于pane或一直可达。实际原生只声明执行过的相邻窄窗、默认字号与恢复路径，不从10个样本推出全部空态/字号/侧栏组合。

## 测试与台账

core-full JSON及原始footer一致：**245文件，1728 tests /1595 pass /122 fail /9 cancelled /2 skipped，exit1**。顶层1698不是总测试数。超时owned文件记录为work-lease-handoff，约326.32秒结束，未改记通过。

最终browser-full JSON及footer一致：**28文件，200 tests /175 pass /25 fail /0 cancelled /0 skipped，exit1**。文档保留首次browser与最终运行的计数差异，不把载入失败或超时所未执行的子用例补成通过。tabs-green为**18/18**，属于明确的关联范围，不覆盖全量失败。文档没有将122个core失败或25个browser失败整体宣称为已证明的历史基线。

W03/W04/W05的正式status均为 **planned**，正式evidence均为空。W03开发记录为in-progress，W04/W05新增子记录为limited-windows-package-verification，说明包含上述失败/取消、761/760差异、容量及未验收范围。未以本轮窗控专项推进整组正式验收。

## 离线范围

前两次启动的offline仅在就绪后启用，正文只称离线运行。第三次offline-ready记录及对应harness顺序为取得firstWindow→设置renderer/context offline→等待真实app-menu就绪→读取bootstrap；正文明确这一受控时间点。它不能证明firstWindow之前每次加载都已断网，也不是OS全断网、NSIS安装或全部业务离线验收。台账未将它扩大为这些结论。

因此本轮可据实交付修复与最终包，并同时保留全量失败、取消及正式未验收状态。本审核没有修改任何原结论或隐藏限制。
