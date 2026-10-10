# 关闭装饰 cell 与像素相位补充方案独立审核

日期：2026-10-10（Asia/Shanghai）。范围为主代理本次明确提出的几何修正方案、隔离机械原型与来源证据；未编辑产品、测试或原方案，未运行测试。本补充替代原方案审核中 `right−28/top+11` 的小图标 host 几何认可，不撤销顶部布局、原生行为和验收边界。

结论：**补充技术方案通过，可按下列具体要求实现。** 这是方案阶段结论，不是当前原型代码或最终包验收通过。原产品的普通状态错位已经由原图数值证明；须以修正后的产品、包和真实 Windows 操作完成后续阶段。

## 方案与来源

采用整个关闭 cell 的透明 BaseWindow + ImageView：本机固定 Electron 44.6.0 下宽 46 DIP，normal `content.right−46 / content.top+1 / 46×31`，max `content.right−46 / content.top / 46×32`。保留原生窗口、命中、Snap、关闭/草稿流程，装饰无 renderer、无交互、无焦点、无任务栏。46 DIP 是本机候选经 normal/max glyph 横向位置校准的有限常量；相同 glyph bbox 支持候选对齐，不能据此宣称公开 API 返回了精确 cell，也不能由保留区 137/138 DIP 三等分推导。

[WinFrameView](https://raw.githubusercontent.com/electron/electron/main/shell/browser/ui/views/win_frame_view.cc) 的 `WindowTopY / TitlebarHeight` 解释 normal/max 高度差；[WinCaptionButton](https://raw.githubusercontent.com/electron/electron/main/shell/browser/ui/views/win_caption_button.cc) 的 `PaintSymbol` 对完整内容矩形按 OS scale 取整再居中，解释小 host 不能复现分数 DPI 相位。所读 upstream main 是机制参考，不冒充已获取固定 v44.6.0 源码。

bitmap 以 `round(46×scale)` 宽、`ceil(cell.height×scale)` 高分配全透明 premultiplied BGRA；把 `round(10×scale)` glyph 放在 cell 像素矩形中央。另计算整数像素相位：`owner client 原点换算 + round(local cell offset×scale) − host 原点换算`，将相位用于 glyph 子矩形位置。两次原点换算均调用 `screen.dipToScreenRect(owner, {...origin,width:0,height:0})`，明确使用同一 owner 显示器；[screen API](https://www.electronjs.org/docs/latest/api/screen#screendiptoscreenrectwindow-rect-windows) 不提供原生 glyph 线宽或按钮矩形。应用 zoom 不参与这套绘制。

审核者仅解码原始 JPG、计算阈值 120 的暗像素，未裁剪、重采样或生成图片：`calibration-phase-normal-native.jpg/bold.jpg` 同 bbox `[874,12,883,21]`、23→38；max bold 与既有干净 max native 同 bbox `[2532,10,2541,19]`、20→41。更新为 owner rect 换算后，`calibration-rect-normal-native.jpg/bold.jpg` 亦为同 bbox、23→38。`calibration-rect-initial.json` 和 normal-bold JSON 记录 actual normal phase `(0,1)`、sourceHash `ec9a3d28cc7bd3cd0fb7f6ac7fb49f4bc032f9c5aa40bb11acb5dcaa28855a44`；审核时 `calibration-accent.cjs` 实际 SHA256 相符，零面积矩形仍返回正确非零原点。rect 路径的 max/restore/移动等最终产品证据仍待执行；名为 moved 的当时样本 bounds 未变，不把它计作实际移动通过。

## 实现与验收要求

- hover 使用同一 cell bounds，包含最大化顶部 y=content.y，排除 right/bottom 边界；避免红色原生 hover 上仍绘制主题色。当前证据原型尚保留旧 top+1 hover 判断，不予当前代码通过。
- bitmap 缓存包含 scale、cell 尺寸、颜色与相位；同 DIP 几何但换算结果改变仍重绘。shape 缓存包含 OS scale：同 DIP bounds 换 DPI 亦重新调用 setShape；normal/max 更新 window、ImageView 与 shape。实际 host 可钳制为 normal 47×38、max 46×38 DIP，透明和穿透检查覆盖整个实际矩形，不把目标 cell 当实际窗口尺寸。
- 继续独立维护可见性缓存、owner enabled/modal/fullscreen gates、无激活 show、owner Z-order、所有监听器/timer/WeakMap 清理。只改变绘制几何，不引入窗口命令、写数据或新的 Electron 包/原生依赖。
- 主方案及测试清单同步删除已被本补充取代的旧几何和旧钳制尺寸声明。以最终源 hash 关联测试、构建、包内 main 与真实包验收；校准原型只证明技术可行性，不能替代产品关闭、Snap、hover、焦点与生命周期验收。

## 完整运行边界

审核实际读取当时 `core-full.tap` 完整 footer 与 `core-full.json`：1739 tests、1608 pass、123 fail、6 cancelled、2 skipped、exit 1，二者一致。这是新几何实施前的完整运行，不能作为新源代码通过。原 browser/旧包证据同样保留其真实版本与失败；不能称全量、跨 DPI、两平台或安装验收完成。W03/W04 与既有业务台账状态不因本方案审核提升。
