# 顶部对齐与关闭加粗代码独立审核

日期：2026-10-10（Asia/Shanghai）。只读审核 DesktopApp、WindowControls、ChatPanel、ContentTabs、desktop.css、native-close-accent、三个原生窗口入口、window-appearance，以及指定新增/更新测试；只写本审核文件，未改产品或测试，保留已有修改。

结论：**代码审核通过，无剩余阻断项，可进入全量及真实Windows验收。** 两项审核中提出的问题已修正：原生对话框的禁用owner状态纳入隐藏条件；真实主题setter对已安装装饰的接线增加独立测试。此结论不代表真实OS的绘制、Z-order、点击穿透、Snap、关闭落盘或全量验收已经通过。

## 产品代码核对

- DesktopApp在原外观effect同步root caption zoom，仍保留原root字号、正文/设置外观处理。Sidebar/Chat/ContentTabs仅增加Windows caption标记；Web/mac JSX类和原handler未重写。真实Web业务正文、DashboardShell Group及编辑器实例保持原实现。
- desktop.css将Windows行固定为`32/zoom`、sidebar/chat/menu命中区`28/zoom`、内容工具`24/zoom`，SVG独立反zoom；有Tab时取消旧pt/top/mb位移，Tab自身border-top与padding-bottom、标题行border-bottom与padding-top作对称补偿，使按钮和SVG中心保持16 DIP。嵌套Tab关闭按钮另保留15 DIP/12 DIP glyph，未被通用28 DIP规则误放大。
- 窄nav使用`body[data-platform="win32"] .dashboard-shell > nav`的flex order放到底部，未复制导航或改DashboardShell handler/Panel结构；Web/mac仍原顺序。实际Shell受控fixture覆盖窄工作区切换与标题起点。标题与Tab工具的尺寸变化限于桌面顶部。
- 三处原caption/env fallback、`138/zoom`预留仍存在；右侧额外空间由旧40 CSS px改为`28/zoom + 12px`，对应新菜单宽度加原间隙。菜单right仍加6 CSS px，因此内容工具右缘到菜单左缘仍有6 CSS px，未以本轮对齐挤入原生命中区。未改mac交通灯安全区。
- native-close-accent以content bounds求`right−28/top+11`，避免最大化隐藏外框；bitmap只用OS display scale，应用zoom不参与。10 DIP glyph采用加粗斜线覆盖、对称采样与premultiplied BGRA；normal主题色和hover白色分离缓存。固定Electron 44.6.0布局和真实DPI舍入仍需原生截图验证，不能仅据sqrt(2)公式宣布视觉一致。
- BaseWindow仅含ImageView，无renderer/preload/IPC/session/作品数据，三个窗口入口均在win32分支对实际owned window安装；不会作为新增BrowserWindow进入原cold/session枚举。原32 DIP native overlay、三个原生命中、Snap和main的close→beginClose/保存许可路径未替换。
- `setIgnoreMouseEvents(true)`覆盖装饰交互，`setShape([{x:0,y:0,width:10,height:10}])`将绘制/交互形状限制在ImageView范围，避免系统32..33×38 DIP最小窗口矩形的多余区域。`showInactive()`后`moveAbove(owner.getMediaSourceId())`使用真实owner媒体ID定位Z-order，没有使用alwaysOnTop。两方法在本地electron.d.ts中存在且签名一致；官方 [setShape](https://www.electronjs.org/docs/latest/api/base-window#winsetshaperects-windows-linux-experimental) 说明形状外不绘制、鼠标穿透，[moveAbove](https://www.electronjs.org/docs/latest/api/base-window#winmoveabovemediasourceid) 接收window媒体ID。setShape属Experimental；实际裁剪、Z-order与点击效果仍须本机原生验收，有限替身只能证明调用。
- 显示状态独立于bitmap/geometry缓存：hide/min/fullscreen/modal后恢复相同bounds/cursor也会重新showInactive。owner/display事件立即sync，40ms轮询补充cursor/状态，timer unref；disposed检查、owner/装饰destroyed检查、closed清timer/所有监听器/WeakMap并销毁装饰，避免退出残留。

## 审核修正与测试核对

1. 初读隐藏条件仅枚举Electron modal child；实际index/relocation还使用原生dialog，不可由getChildWindows证明覆盖。最终实现补`!owner.isEnabled()` gate；CLOSE-04在children为空时enabled=false隐藏、true恢复。真实原生目录/确认框的isEnabled状态与取消恢复尚待主代理实测。
2. 初读CLOSE-05只调用颜色helper，WTHEME owner未安装accent，未证明实际applyWindowAppearance接线。最终CLOSE-06在真实controller fixture上调用真实setter，覆盖paper/ink/system两种系统状态并检查bitmap和32高度；初始show的moveAbove owner ID亦加入断言，产品恢复显示路径同样执行该调用。产品setter正确同步原native symbolColor与装饰。
3. caption-alignment浏览器用例使用真实SidebarWindowControls、AST真实ChatPanel标题、实际ContentTabs和真实DashboardShell/Group；只隔离无关正文/AI effects/注册边界。五zoom×三字号×空/单/多Tab逐个button/SVG测中心，同时保留真实导航、菜单、最后Tab关闭、no-drag及窄nav切换。fixture正确初始化body/root外观；仍是CSS受控几何，不是Electron真实zoom或完整业务通过。
4. 更新的chat-caption-safe-area菜单期望为top=`2/zoom`、28 DIP命中区与16 DIP中心，保留right safety和click/Enter/Space command记录。empty-content-hide针对Windows采用DIP期望、Web/mac继续rem尺寸及包含/拖拽断言；sidebar-restore仅同步fixture外观，mac/Web安全区断言未弱化。
5. 本轮RED文件记录ALIGN五test中三失败/二通过，失败含真实center mismatch和窄nav位置；关闭接线三test实际calls=0失败。接线RED不是像素粗细行为RED：旧包/无装饰同条件截图及最终像素比较仍需在最终证据中明确，不把缺接线单测或缺模块当作完整视觉RED。

## 独立执行与后续边界

审核者使用bundled Node **v24.19.0** 执行最新`node --import tsx --test tests/unit/native-close-accent.test.ts`：**8/8 pass、0 fail/cancel/skip、exit 0**，包含三窗口接线、geometry/raster、同bounds恢复、enabled/modal、display/hover/清理及实际主题setter。首次受沙箱限制的spawn EPERM没有执行测试；自动审批后的真实命令正常完成，不把环境错误计作行为RED。

读取当时targeted-green.tap的完整footer为49/49 pass、0 fail/cancel/skip；该文件早于最后新增CLOSE-06，不将49项扩大为最新组合或全量通过。类型检查是主代理已报告的结果；本审核没有重复类型/构建。全量runner已纳入CSS来源hash，补足前轮只收TS/JSON的来源边界。

最终门槛仍是本机实际normal/hover/pressed/快速离开、主题、focus/modal、移动/缩放/max/min/hide/fullscreen恢复、整个shape/钳制区、原生Snap/关闭保存取消/重启及完整core/browser结果。轮询不承诺逐帧复制原生动画；单机DPI、固定Electron、未安装/未执行平台应据实限定。W03/W04与业务正式验收不得因本代码审核提升。
