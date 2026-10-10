# 顶部对齐与关闭加粗测试清单独立审核

日期：2026-10-10（Asia/Shanghai）。本阶段只读审核修订后的 `caption-alignment-test-cases.md`、已通过的技术方案/方案审核，以及现有真实组件测试和执行入口；只写本审核文件，未改产品、测试或测试清单，未执行本轮测试。

结论：**测试清单通过，可进入实质 RED 和 TDD 实现。** 先前提出的相同 bounds/固定 cursor 恢复、整个装饰钳制矩形、监听器清理、模态/快速 hover、fixture 外观初始化及 CSS 来源快照要求已写入清单；没有剩余阻断项。本结论只批准覆盖与方法，不表示 GREEN、原生产品效果或全量验收已通过。

## 覆盖与真实执行方式

- **ALIGN-01/02** 覆盖实际 SidebarWindowControls、ChatPanel 标题 JSX、ContentTabs 和原 DashboardShell 导航/Group。`WindowControls.tsx` 的28 CSS px控件、ChatPanel的rem控件、ContentTabs有Tab的顶部/底部偏移，以及root字号和应用zoom是不同来源；逐个测button与SVG中心，五档zoom×三档字号×三种Tab状态，能检出只改容器高度或仅修菜单的实现。窄视口另测workspace起点与底部真实导航、handler和状态，弥补目前纯标题fixture不能证明完整Shell响应式布局的边界。
- 现有 `tests/browser/chat-caption-safe-area.test.ts:13-58` 通过TypeScript AST取真实ChatPanel header，用esbuild打包真实WindowsMenuControl，PostCSS/Tailwind加生产desktop.css，在Playwright Chromium中运行；仅命令边界有限记录。`empty-content-hide.test.ts:15-54` 使用真实ContentTabs/SidebarWindowControls和真实tabs store，只stub无关业务正文。该方式适合几何/事件回归，不能宣称实际Electron zoom、原生菜单、业务保存或Snap通过。
- 新Windows固定DIP期望应明确为菜单top=`2/zoom`、sidebar/chat/menu命中宽高=`28/zoom`，内容工具=`24/zoom`，中心CSS坐标乘zoom≈16 DIP；SVG也单独验证。0.6 DIP容差用于布局/原生舍入，不应放宽成比较三个错误中心彼此相等。应从窗口内容顶部计量，并在Tab横向裁剪/滚动后识别真正可见的控件，避免把可见性与“DOM中存在”混同。
- 当前上述fixture只设置root字号及bootstrap，没有执行DesktopApp外观effect；清单已要求同步生产的body平台与root caption zoom并覆盖live变化。测试不得靠额外fixture样式直接强制正确高度/位置。现有env宽度替换仅作为受控CSS输入，保留无env fallback及原caption/menu/right安全间距。
- **ALIGN-03** 保留Web/mac的44默认行、rem图标/命中区、原Tab rail、mac安全区、事件和拖拽回归。`empty-content-hide.test.ts:67-74` 当前共用rootRem断言需要对Windows改为最新DIP合同，而Web/mac继续原断言；`pane-window-drag.test.ts` 的实际Tab激活、关闭/最后Tab、滚动与no-drag不能因本轮几何变化删除。上一轮菜单固定28 CSS px/top截断的期望已被最新需求覆盖，更新该期望不是弱化回归。
- **CLOSE-01/02** 要求测试真实生产helper/controller，Electron替身仅提供边界；独立content坐标、OS scale与像素覆盖/对称/alpha格式断言，以及正常构造和主题setter实际挂接，能同时发现位置错误、透明格式错误和“helper正确但产品未接入”。数学scale单测不当作真实跨屏DPI验证。BaseWindow/ImageView无renderer的约束、无焦点/任务栏、点击穿透和不新增BrowserWindow，保持根目录session检查和原关闭路径的范围。
- **CLOSE-03** 将normal/opaque红hover/pressed、paper/ink/system、失焦/模态、快速进出、move/resize/max/restore/min/hide/fullscreen、75/100/200实际zoom和关闭保存/取消/重启列为真实Windows验证。整个32..33×38 DIP钳制矩形的透明、无阴影和穿透要求，覆盖10×10图像以外仍可能挡住邻近命中的风险。旧包/无装饰同条件像素比较与最终原始截图共同证明加粗和无双X，不能仅凭stroke系数、JSON坐标或spike口述。

## 已知风险与阶段门槛

1. `paint-spike.cjs:15-21` 的hide路径保留previous，恢复同bounds/hover时可能提前return；清单现已分别在controller测试及真实包要求cursor在关闭区外、bounds不变的min→restore和hide→show后恢复可见。此专门场景不能被恢复后移动鼠标替代。
2. closed须同时清理owner/display监听器与timer，已销毁/重入安全；真实退出仍须通过原生X及既有保存协调流程。装饰存在时的BrowserWindow/BaseWindow计数和关闭重启无遗留窗口应记录实际观察，不能仅检查构造选项。
3. 若最终换用原生鼠标消息，应先保留消息到达/离开/复位的机械证据，再执行完整状态清单；有限Electron替身无法证明Windows消息到达。40ms轮询或消息绘制均不意味着逐帧复制原生颜色动画。固定Electron/单机DPI证据的边界须保持。
4. **TDD门槛明确。** ALIGN应在旧生产CSS上因真实几何失败；CLOSE缺模块/编译错误只能说明尚无实现，须另有旧包/无装饰像素行为RED。实现之后独立code review再GREEN与原生验证，不把浏览器缺失、EPERM、超时或取消记作行为RED或通过。
5. `package.json` 的test入口是Node `--import tsx --test` 的unit/integration，browser是同类node:test文件内启动Playwright，不是仅列出用例。全量core/browser应分别保留实际命令、来源hash、完整TAP footer、exit/fail/cancel/skip；顶层test计数不按循环矩阵扩增。旧runner的来源正则只收TS/JSON，修订清单已要求本轮纳入desktop.css，避免遗漏主要样式变更。
6. 前轮core/browser仍有失败；BUILD-01据实记录而不预认“基线失败”正确。类型/构建、最终包资源、离线隔离启动和artifact hash验证不能替代两平台/业务正式验收；W03/W04与未执行的实际DPI/macOS项目继续保持待验收。

上述非阻断项是后续实现、code review及真实验收的执行约束。此次独立审核没有把模拟平台、受控命令边界或机械spike提升为原生产品通过。
