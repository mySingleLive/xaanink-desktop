# 顶部对齐与关闭加粗测试清单

日期：2026-10-10。等待方案审核后再独立审核本清单；不把机械spike当产品通过。

最新补充用例覆盖并取代下文最初10×10 host几何：CLOSE-02期望normal46×31/top+1、max46×32/top0；CLOSE-07独立数值期望OS scale1/1.25/1.5/2及负/零/正相位，完整cell透明padding、中心位置与BGRA，普通/最大化变化；CLOSE-08同bounds投影相位变化触发重绘、shape/ImageView跟随normal/max、max顶部第一DIP白hover。转换统一使用owner的dipToScreenRect；fixture明确声明该边界API。RED必须是旧真实geometry不符合新期望，新增helper尚不存在的导入错误另记，不能代替该行为RED。

原生补充：同一隔离窗口关闭层开/关原图、普通/最大化、真实拖动改变窗口原点相位，记录候选源码hash、requested/actual/content/ImageView、投影和phase；确认两种窗口状态同native glyph bbox且加粗。最终包另外验证normal/max/restore/hover/min/fullscreen，最终产品hash与包内main一致，完整core应对应新几何版本。已有浏览器完整结果涉及未改变的renderer；关联浏览器仍重跑，不把旧core或旧包拼接成新版本完整通过。

1. ALIGN-01：实际 SidebarWindowControls、AST提取真实ChatPanel header、实际ContentTabs（仅stub无关业务内容）加生产CSS；Windows .75/1/1.25/1.5/2 zoom × 11/14/24字体 × 空/单Tab/多Tab。明确每个可见顶部button与SVG的中心为16 DIP（浏览器CSS几何乘zoom），容差0.6 DIP；无顶部越界。sidebar后退/前进/toggle、chat恢复左右、empty hide、tab close/fullscreen/hide、菜单逐个测量，不仅比较容器高度。
2. ALIGN-02：原DashboardShell导航/Group JSX或实际Shell的受控业务fixture，视口1440与760（除zoom），Windows workspace起点0、窄nav在底部；真实导航切换sidebar/chat/content、侧栏/内容显隐与全屏按钮实际handler有效；Tab激活/关闭（含最后一个）及横向滚动、no-drag、原caption右safe area均保留。纯组件fixture不替代真实业务成功。
3. ALIGN-03：Web/mac 原h-11/44默认、Tab rail原布局、mac安全区、事件/拖拽/标题恢复回归保持；仅修改上一轮菜单宽高/top期望以符合最新固定DIP对齐需求，不弱化right间隔/handler。
4. CLOSE-01：针对真实生产纯geometry/raster helper，独立期望content right−28/top+11、OS DPI1/1.25/1.5/2；最大化隐藏外框不影响位置，10 DIP glyph、非premultiplied/ premultiplied格式正确、X对称、stroke覆盖增厚、hover白/normal主题色。应用zoom不参与glyph计算。
5. CLOSE-02：通过真实装饰controller与有限Electron边界替身检查只有BaseWindow/ImageView，ignoreMouseEvents/focusable/skipTaskbar、无WebContents/加载URL/IPC；生命周期及时move/resize更新、隐藏/min/fullscreen、restore、主题、closed销毁/清timer、窗口已销毁时安全，不新增BrowserWindow。固定cursor在关闭区外、bounds不变，min→restore及hide→show后明确断言装饰重新可见，不以鼠标移动改变cache掩盖问题。实际main正常构造与主题setter挂接也要独立执行验证。
6. CLOSE-03：隔离真实Windows包，正常/hover/pressed（按住后移出释放）、主题paper/ink/system、焦点失活、move/resize、max/restore/min/全屏、75/100/200%实际zoom；截图核对没有双X且关闭比旧图加粗，native hover红/白且原生点击穿透，Snap可见、关闭保存/取消后仍可用、正常关闭重启无遗留装饰；记录实际BrowserWindow与BaseWindow计数。固定关闭区外cursor及相同bounds的min→restore、hide→show后观察装饰恢复；对系统钳制的整个32..33×38 DIP矩形核对其余区域透明、无阴影与点击穿透，不仅验证10×10 X。硬件只有单机DPI时明确局限，不用数学fixture冒充跨DPI实测。
7. BUILD-01：关联与全量活动core/browser各自记录footer/exit/fail/cancel/skip，Node24类型、生产构建、包资源、离线隔离启动和最终artifact哈希。前轮全量并未全过，不能声称其它失败已证明为基线。command catalog源hash按实际变更更新，不靠未验证换行改写混过构建。

所有browser fixture按生产外观初始化body平台与root caption zoom，并在live外观改变时同步；本轮来源快照包括CSS，补足上一轮runner只纳入TS/JSON的边界。

CLOSE-02的closed清理同时检查全部owner/display监听器与timer；CLOSE-03另执行原生模态/取消返回和快速hover进出。若实际选用native消息路径，先保留消息到达/离开/复位的机械证据，再测相同完整状态，不以源代码或mock替代消息实测。

TDD：先写ALIGN真实几何断言及CLOSE真实helper/controller测试，在旧CSS与无装饰代码下保存实质失败；缺模块/编译失败只能说明实现不存在，CLOSE必须还有旧包/无装饰像素比较，不能单用导入失败冒称行为红灯。实现后先code review，再完整GREEN/原生验证和独立证据审核。每个顶层test统计一次，矩阵场景不重复计数。
