# Windows 顶部对齐与关闭加粗方案

日期：2026-10-10。最新用户要求所有三栏顶部按钮与原生窗控同一垂直中心，并明确加粗关闭图标；后者覆盖上一轮保留关闭线宽的选择。继续使用真实 Web 组件、原生命中/Snap/关闭保存流程。

## 对齐

原生 overlay 仍32 DIP。Windows 顶部行、按钮、SVG 尺寸使用同一反向应用 zoom 的 DIP 基准：三栏/菜单中心16 DIP，sidebar/chat/menu命中28 DIP，内容区工具24 DIP。仅这些桌面顶部控件不再随正文字号和网页 zoom 二次放大；正文、设置、业务控件原缩放不变。DesktopApp 在已有外观effect设置全局zoom变量；真实 SidebarWindowControls/ChatPanel/ContentTabs 增加窄范围标记或使用稳定选择器。

有Tab的头部取消 Windows 的 pt-1.5、mb-1 和 scroller top-px 垂直位移；Tab/内嵌关闭按钮也按同中心测量。窗口右侧既有 env/138/zoom 保留。Web/mac 无该覆盖。Windows 窄布局的原工作区切换 nav 从三栏之前移至三栏之后（底部），保留真实三按钮及handler，避免响应式导航将全部顶部下推。

## 关闭绘制

### 后续几何修正（本轮最新方案）

以下整 cell 方案取代本文后面的初始10×10 host定位。原始截图独立像素读取发现小 host 在150%系统DPI下普通窗口偏上两行；整cell未补相位时仍偏上一行。当前机械候选在同一普通窗口原图中 native/bold bbox均[874,12,883,21]、暗像素23→38；最大化bbox均[2532,10,2541,19]、20→41。候选源码hash、实际bounds和相位记录在 calibration-rect-*.json，机械截图不能替代最终产品验证。

透明host覆盖固定Electron44.6.0经本机normal/max原生glyph位置校准的46 DIP关闭cell；normal content.top+1、高31，max content.top、高32，不从normal137/max138总保留宽度均分推导。ImageView和shape使用同cell；系统钳制后的其余host像素仍透明。canvas宽round(46×OS scale)、高ceil(cellHeight×OS scale)，round(10×scale)的X居中绘制。原生本地client坐标和独立窗口screen坐标有分数DPI舍入相位：使用screen.dipToScreenRect(owner,零宽高origin)固定owner显示器，phase=client原点像素+round(cell本地offset×scale)−host原点像素，将图标按整物理像素平移。缓存包含高、相位、scale和颜色；同bounds转换改变仍重绘。hover复用同cell，覆盖max顶部第一DIP。该布局绑定固定Electron，本机实际DPI仅1.5，其他DPI/多显示器仅算法fixture覆盖，不冒称实际通过。

公开 overlay 接口没有单独线宽。underlay会被opaque红色hover遮住，不采用。上游机制来源：[WinCaptionButton](https://github.com/electron/electron/blob/main/shell/browser/ui/views/win_caption_button.cc)、[WinFrameView](https://github.com/electron/electron/blob/main/shell/browser/ui/views/win_frame_view.cc)。当前本地Electron固定44.6.0。

采用零renderer装饰：一个属于主窗口的透明、无焦点、skipTaskbar、ignoreMouseEvents 的 BaseWindow + ImageView，只绘制10 DIP关闭X。它不是BrowserWindow、不装preload/IPC/会话/网络/作品数据。原生三个控件仍保留全部命中和系统流程，装饰不处理点击。像素图以OS显示scale绘制、stroke系数sqrt(2)补偿斜线视觉，不受应用zoom影响；normal使用symbolColor，hover/pressed使用白色覆盖原生白X。轮询仅本机cursor与可见性（40ms、不记录位置），move/resize/display事件立即同步；主题同步更新。最小化/隐藏/原生全屏隐藏，closed先销毁装饰和timer，无额外BrowserWindow影响根目录session检查。

装饰位置用getContentBounds而非getBounds（最大化外框带隐藏边框）。此固定Electron布局的close横向区域46 DIP，glyph10 DIP；起点content.right−28、content.top+11，必须由实际normal/max/restore截图核验并测试DPI舍入。不能从138三等分推导所有未来Electron/RTL版本。

显示/隐藏与像素/几何缓存分离，hide后使缓存失效或restore/show时无条件恢复showInactive，避免相同bounds和cursor下永久隐藏；失焦/模态/全屏与快速hover进出单列核对。不承诺装饰与原生hover动画逐帧同色。若实际机械验证WM_NCMOUSEMOVE/LEAVE能可靠识别HTCLOSE，可用原生消息替代cursor轮询，依然须通过同一状态测试。

机械spike在隔离900×580无数据窗口已观察normal/红hover、原生最大化/关闭可点击，getAllWindows仅1个BrowserWindow；BaseWindow为2个。最初外框坐标在最大化发生错位，已改内容区坐标并观察稳定对齐；源文件与JSON在docs/evidence/caption-alignment/paint-spike.*。这只证明技术可行性，不计产品验收。BaseWindow受系统最小尺寸钳制约33×38 DIP，只有10×10 ImageView有像素，其余透明且点击穿透。正式验证须包括真实工作台所有状态、主题、焦点、拖动、hide/min/max/restore/fullscreen、缩放和现有关闭落盘；单机器DPI局限据实记载。

## 顺序与交付

独立方案审核 → 独立测试清单审核 → 实质RED → 产品实现 → code review → 关联与全量core/browser、类型/构建/包 → 本机隔离真实组件操作和证据审核。未执行和失败不得写通过，正式W03/W04及业务台账不因本轮有限修复提升。保留前轮全部未提交修改，不修改上游目录。
