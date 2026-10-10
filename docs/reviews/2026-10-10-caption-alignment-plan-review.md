# 顶部对齐与关闭加粗方案独立审核

日期：2026-10-10（Asia/Shanghai）。只读审核 `caption-alignment-plan.md`、真实三栏/桌面入口、原生构造/主题/关闭流程，以及 `docs/evidence/caption-alignment/paint-spike.cjs` 与 JSONL。只写本审核文件，未改产品或测试。

结论：**技术方案通过，可进入独立测试清单审核。** 最新用户明确要求关闭加粗，覆盖上一轮保留原始 glyph 线宽的选择；无需重复 UI 批准。方案保留真实 Web 组件、原生三个控件、Snap 和既有关闭保存路径，未发现需要否决该技术方向的阻断项。以下实现与验证约束必须落实，机械 spike 不能直接作为最终代码或验收。

## 源文件与边界核对

- `WindowControls.tsx:8` 的 sidebar 是 h-11/居中，按钮为28 CSS px、SVG为1rem；`ChatPanel.tsx:1666-1702` 同为 h-11，恢复控件1.75rem、SVG1rem。`ContentTabs.tsx:73-188` 空态 h-11、按钮1.5rem，有 Tab 时则为 items-end/pt-1.5、tab高2rem、工具mb-1、scroller top-px，tab关闭15px。这些不同单位/偏移解释了当前中心不一致。
- `DesktopApp.tsx` 外观 effect 将根字号设为 `16 * uiFontSize / 14`；`settings.ts` 允许11..24字号与0.75..2 zoom，`main/index.ts:669` 另设置真实 webContents zoom。因此仅改44→32 CSS px或上移统一6px无法覆盖全部设置。Windows反向zoom的固定DIP行、控件、SVG与Tab关闭中心能解决该实际原因；只限桌面顶部，正文/设置与业务组件缩放保留。
- `DashboardShell.tsx:476-480` 的窄工作区 nav 位于 workspace 前，确实下推所有三栏标题。将这组真实按钮在 Windows 放到workspace之后解决下推；保留原handler、面板实例和业务状态，Web/mac保持原顺序。测试应明确验证底部导航仍可达、选中/禁用状态及原窄布局切换。
- 原生 helper保持32 DIP、透明底和symbolColor；三个活动构造仍共用配置。`main/index.ts:700` 左右的 close handler 继续阻止未获许可的关闭并进入 beginClose/保存协调流程。装饰无需新关闭IPC，不应调用destroy/quit代替原生点击。
- 本地 Electron 44.6.0 类型声明 `electron.d.ts:2129,4216,5469,8782` 区分 BaseWindow/BrowserWindow/ImageView。现有主/维护/重定位冷会话检查枚举的是 BrowserWindow，并读取其webContents/session；零renderer BaseWindow不会作为BrowserWindow进入这些检查。仍须验证主窗销毁时装饰销毁，使 window-all-closed/退出语义正常。

## 机械 spike 的支持范围

spike的装饰构造为透明、无焦点、skipTaskbar、ignoreMouseEvents 的 BaseWindow，其contentView仅有ImageView；装饰没有loadURL、preload或webContents。JSONL记录BrowserWindow=1、BaseWindow=2，支持“多一个原生装饰窗口、没有多一个业务renderer”的结论。

JSONL最后记录最大化content=(0,0,2560,1392)、起点=(2532,11)、scale=1.5，与当前 `content.right−28/content.top+11` 相符；此前记录=(2541,4)属于外框计算旧分支，不能算正确对齐样本。主代理报告实际Sky已观察修正后稳定单X、normal/opaque红hover可见及原生max/close点击，第二次driver正常退出。JSONL本身仅能证明坐标、计数与状态，不能独立证明视觉粗细或没有双X；正式产品仍须保存原始截图/操作与状态证据。

该方案较underlay能覆盖hover：上游 [WinCaptionButton](https://github.com/electron/electron/blob/main/shell/browser/ui/views/win_caption_button.cc) 在关闭hover使用opaque红并将符号变白，underlay会被遮住；上层ImageView只覆画X而保留原生命中。固定46/10 DIP布局与sqrt(2) stroke为本机版本候选，视觉一致需实测，不能仅以系数或bitmap单测宣布完成。[NativeImage接口](https://www.electronjs.org/docs/latest/api/native-image#nativeimagecreatefrombitmapbuffer-options) 支持显式scaleFactor，但bitmap格式是平台相关；该绘制路径应仅Windows使用。

## 必须落实的实现/测试约束

1. **显示状态须独立于绘图缓存。** 当前 spike 在min/hide时仅 hide，然后保留previous；恢复到相同bounds/hover/scale会因key相同提前return，装饰可能一直隐藏。主代理已确认产品将隐藏后使缓存失效、restore/show重新showInactive，并将显示与image缓存分离。用“cursor不在关闭区、相同外框、min→restore及hide→show”专门验证，不能以恢复后移动鼠标触发重绘掩盖。
2. 父窗closed先清除timer/listener并销毁装饰；父窗destroy、装饰已destroy、退出重入均应安全。native fullscreen/hide/min需隐藏，恢复重新显示。装饰不得获得焦点/任务栏入口、阻挡原生点击或参与草稿/迁移会话。
3. 40ms轮询只处理本机cursor/可见性，不保存位置；move/resize/display变化立即同步。native hover存在背景与前景动画，装饰白色切换不等于逐帧复制原生动画。需验证快速进出hover、pressed、失焦/模态状态，不能宣称所有动画帧完全一致。主代理另提出观察WM_NCMOUSEMOVE/LEAVE实际HTCLOSE来替代cursor轮询；该候选须先机械验证消息到达与离开/复位行为，不作为当前通过依据。公开hook是观察接口，无需也不应替换原生命中返回值。
4. 用getContentBounds规避最大化隐藏边框；实际检测normal/max/restore、移动及缩放后单X、没有阴影/残影。BaseWindow实际钳制32..33×38 DIP，超过10×10ImageView；整个钳制区域须透明、点击穿透，不能只测试绘制10×10范围内点击。
5. 主窗OS DPI与应用zoom必须分开；image bitmap采用OS scale，装饰不跟webContents zoom放大。当前只观察scale1.5；其他真实DPI/跨屏未经执行应保持待验收。46/28/11常数受固定Electron布局、RTL、系统尺寸/舍入影响，不能视为通用公式；升级版本应再验证，不以模拟scale测试冲抵目标机器截图。
6. 三栏标题、菜单、Tab及内嵌close在不同字号/zoom/空态/有Tab/隐藏恢复/窄布局下均测真实中心与命中几何。保留right/env/138/zoom安全区、焦点环和no-drag；原Tab滚动/激活/关闭与未保存编辑器实例不能受固定顶部高度影响。

阶段顺序及失败据实记录与AGENTS.md一致。本审核只批准技术路径，最终真实Windows产品效果、关闭落盘、全量结果和独立代码/证据审核仍是后续门槛；W03/W04与业务正式验收状态不因本阶段提升。
