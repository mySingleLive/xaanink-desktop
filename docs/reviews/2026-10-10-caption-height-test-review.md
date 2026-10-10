# 三栏顶部高度恢复：独立测试清单审核

结论：通过，无阻断。已读取修订后的 `2026-10-10-caption-height-test-cases.md` 和实际 `tests/browser/caption-alignment.test.ts` 测试实现。旧 CSS 仅保存为证据，长期测试不复制产品 CSS；Tab 图标 14 DIP、正文起点及 scroller `scrollHeight <= clientHeight + 1` 已加入。此审核不等同于最终测试执行或实际 Windows 验收通过。

源依据为现有 `tests/browser/caption-alignment.test.ts`、`src/app/desktop.css:13-24` 及真实 `SidebarWindowControls`、`ChatPanel` header、`ContentTabs` JSX。现有夹具从 ChatPanel 源 AST 提取真实头部，使用真实侧栏控制、ContentTabs 和 DashboardShell；仅隔离无关业务效果与正文。它加载实际 globals.css/Tailwind 与 desktop.css，并同步 body 平台、根字号及 zoom。继续这一边界可以检出产品 CSS 回归，不能用复制的 CSS 替代实际源样式。

HEIGHT-01 覆盖五档 zoom × 三档字号 × 空/单/八 Tab，要求三栏头部实际高度 44 DIP；新增正文起点与 Tab 高度 32 DIP 能区分“整个控件向下居中”与“只在下方增加空间”。正文断言针对无额外业务横幅的受控 fixture 中紧邻头部的真实容器；不把横幅高度误判为本轮头部回归。单/多 Tab 的实际 scroller 纵向溢出检查保留 1 CSSpx 整数取整容差，不单看外框 bounding box。

HEIGHT-02 应独立枚举既有 32 DIP 控件区的预期，而不是把修改后的测量值用于生成预期：sidebar/chat/menu 按钮 28 DIP、top 2 DIP；内容直接工具按钮 24 DIP、top 4 DIP；普通 SVG 16 DIP、top 8 DIP；Tab 关闭按钮 15 DIP、top 8.5 DIP，其 SVG 12 DIP、top 10 DIP；Tab 直接图标 14 DIP、top 9 DIP；Tab 外框仍为 32 DIP。均检查 top、width、height、centre。中心容差维持既有 0.6 DIP，覆盖边线与浏览器子像素量化；尺寸与顶部也须有明确合理容差，不以“中心相同”替代尺寸断言。菜单是独立 fixed 元素，也必须包含。

原 ALIGN-02/03 继续检验真实窄布局底部导航、pane 切换、菜单鼠标/Enter/Space、导航/显隐/全屏/Tab 关闭 handlers 与 no-drag；这些无需添加业务实现。Web/mac 保留原样式断言，Windows 专属选择器作用域另由源改动核对；浏览器平台切换仍只证明样式与受控交互，不证明 macOS 原生行为。

实际测试的 `aligned()` 用 DOM 类型及所属 Tab/内容头部分类给出固定 expectedSize，并断言宽高误差小于 0.1 DIP、top/centre 误差不超过 0.6 DIP；预期未读取产品 CSS。ALIGN-01 在完整矩阵中追加三个头部 44 DIP、两个隔离正文容器起点 44 DIP、Tab 数量/32 DIP 高度和 scroller 溢出断言。它继续执行原控件几何检查，未以新头部高度推导控件中心。保留的 ALIGN-02/03 同时受新增尺寸/top 检查覆盖，ALIGN-04 默认 Web/mac 断言保留。

当前 32 DIP 产品上更新 44 DIP 期望应产生明确实际几何 RED，环境失败不算 RED。实现后同命令 GREEN，以及后续完整结果、构建/包/真实 Windows 新包几何与原始截图仍按方案执行并保留失败/取消。比较上轮证据须固定 DPI/zoom；不得仅复用旧包截图作为新实现通过，也不因此提升正式 W03/W04 或业务 planned 状态。本审核未运行额外测试或修改产品/测试。
