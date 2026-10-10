# 关闭装饰 cell 与像素相位实现独立代码审核

日期：2026-10-10（Asia/Shanghai）。独立只读审核 `desktop/main/native-close-accent.ts`、`tests/unit/native-close-accent.test.ts`、补充方案/用例与相关 RED/GREEN、机械证据；仅写本审核文件，未改产品或测试，保留其它修改。

结论：**代码审核通过，无当前发现的阻断项。** 审核者实际执行最新关闭装饰单测：**10/10 pass、0 fail/cancelled/skipped、exit 0**。可进入修正后的完整运行、重包和真实 Windows 验证；本结论不证明最终包绘制、拖动、点击穿透、Snap 或关闭持久化已通过。

## 实现核对

- `nativeCloseGeometry` 使用 owner content bounds 和明确的 maximized 状态，normal cell 为 right−46/top+1/46×31，max 为 right−46/top/46×32。避免旧小 host 依赖整数 DIP 偏移；仍是本机固定 Electron 布局校准，不宣称平台通用按钮 API。顶部 React/CSS 布局和原生 overlay/命中/关闭流程没有因本补充重写。
- `closeCaptionPhase` 将两原点以零宽高 rect 传给同一 owner 的 `dipToScreenRect`；本地 offset 只按 OS scale 取整，两种坐标舍入差进入 bitmap。应用 zoom 不参与。controller 缓存包含 scale、cell 高度、phase x/y 和实际绘制颜色；同 DIP bounds 但换算结果变化仍重绘。
- `closeCaptionBitmap` 用 round(cell.width×scale)、ceil(cell.height×scale) 分配透明 BGRA，原 glyph 在整数像素中心加 phase；复制范围只覆盖 glyph 子矩形。`closeGlyphBitmap` 继续验证有效 scale/色值、采用对称覆盖及 premultiplied BGRA。有限相位 −1/0/+1 在约定 cell 中保有透明边界；没有不透明背景覆盖原生红 hover。
- hover 使用实际 cell bounds，左/top 包含、right/bottom 排除，最大化 content.y 顶边也转白；原型旧 top+1 判定已修复。正常主题与 hover 白色分别进入同一颜色缓存。
- `nextBounds` 同时包含 scale 与矩形；同 DIP bounds 改 OS scale 会重新 setBounds、set ImageView bounds、setShape。normal/max 高度变化亦同步三个对象。constructor 使用 46×31，仍允许系统实际尺寸钳制；shape 和透明 padding 为对应 cell，实际钳制矩形的绘制/输入须由最终包再验。
- BaseWindow + ImageView、ignoreMouseEvents、无 renderer/焦点/任务栏、owner `showInactive/moveAbove` 保持。visible 与几何/bitmap 缓存分离；hidden/min/fullscreen/disabled/modal 隐藏，恢复同 bounds/cursor 会重新显示。dispose 保留幂等保护、timer 清理、全部 owner/display listener 移除、WeakMap 删除与装饰销毁；closed 后 sync/颜色更新不再绘制。

## 测试与实际执行

CLOSE-01 的三窗口实际接线、CLOSE-03 glyph 对称/色值覆盖、CLOSE-04 同 bounds 恢复和 enabled/modal gates、CLOSE-05 清理、CLOSE-06 真实主题 setter 均保留。cell 首像素现在透明，theme/hover 断言改用 `firstInk`，并要求非零 alpha；避免 0=0 虚假通过。CLOSE-07 覆盖 normal/max 高度、四个 OS scale、负/零/正 phase、透明 padding 及独立相位例子。CLOSE-08 执行真实 controller，验证同 bounds 相位变化重绘、同 bounds scale 变化重设 shape、normal/max view/shape、max 顶边与 right/bottom hover 边界。替身断言换算 API 实际 owner 和零宽高 rect，未用替身冒充 Windows raster 或命中。

审核命令：bundled Node **v24.19.0**，`node --import tsx --test tests/unit/native-close-accent.test.ts`。首次 sandbox 执行仅因测试子进程 `spawn EPERM` 未进入用例；随后自动审批的同一命令正常执行，完整结果 10 tests、10 pass、其余 0、exit 0、duration 615.8444 ms。环境错误不计 RED。

审核时 source SHA256：native-close-accent.ts `4c2620e63e5c213c0b9431bdcaebdd073db2ba7bbe560f2c79682a8b8afc9b23`；native-close-accent.test.ts `51e7a364f3194a4c6202842bf314c08eff1e3f88336a60b3aa89c5ae2a446eab`。原 `close-geometry-green.tap` 也为 10/10，但上述独立实际命令才是本审核执行依据。

## 证据与剩余验收边界

`tdd-cell-geometry-red.tap` 明确实际旧 geometry 10×10/right−28/top+11 与新期望 46×31/right−46/top+1 不符，1 test、0 pass、1 fail，是行为 RED。`tdd-cell-all-red.tap` 为 10/5 pass/5 fail，其中 geometry/shape/移动几何/缓存未重绘是实质失败；CLOSE-07 的 helper 尚不存在错误另记，不能把五失败都称像素或算法行为 RED。

主方案/清单已明确最新 cell/phase 补充取代后文保留的旧几何。`calibration-rect-max-bold.json` 记录 phase=(0,0)、cell 46×32、实际 host 46×38、sourceHash ec9a3d28…；审核者只读解码对应原图，bbox `[2532,10,2541,19]`、暗像素 41，与干净 native max 的 bbox 相同。此前 rect normal 成对原图同 bbox 23→38；都只属于隔离机械校准，不是最终产品截图。

修正前完整 core 1739/1608 pass/123 fail/6 cancelled/2 skipped、exit 1 仍属历史版本，不能挂到上述新源作为通过。机械 moved-bold 的 bounds 未变，明确不计真实拖动。本轮最终完整 core/browser、类型/构建、包内 main/installer hash、真正拖动与 normal/max/restore 相位、整个实际钳制区、hover/Snap/原生关闭及重启草稿保留仍需最新产品执行；未安装、跨 DPI/多显示器/mac 和正式 W03/W04 不提高状态。
