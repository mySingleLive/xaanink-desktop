# 关闭装饰 cell 与像素相位补充测试独立审核

日期：2026-10-10（Asia/Shanghai）。审核主代理提出的 CLOSE-07、CLOSE-08 补充要求、既有 `tests/unit/native-close-accent.test.ts` 和几何修正方案。仅写本审核文件，未编辑产品/测试、未执行测试；审核的是测试设计，不是测试结果。

结论：**补充测试方案通过，按以下范围落地后进入 RED→实现→code review。** `2026-10-10-caption-alignment-test-cases.md` 原 right−28/top+11 及 10×10 shape 期望被本次 cell 方案替代；正文应同步，不能保留相互矛盾的正式要求。

## 覆盖要求

1. CLOSE-07 独立执行真实生产 cell/raster helper，normal `right−46/top+1/46×31` 与 max `right−46/top/46×32`，使用非零 content origin 和隐藏外框反例，仍不依赖应用 zoom。对 OS scale 1/1.25/1.5/2 验证 canvas 宽 round、高 ceil、glyph round 与居中整数像素位置；独立列明负/零/正相位的输入和期望，不能直接用被测实现生成期望。逐像素验证 glyph 子矩形外 BGRA 全零、子矩形内 premultiplied 色值/alpha、glyph 形状与加粗覆盖；相位使整个 cell 不再必须对称，原 glyph 子矩形的对称检查继续保留。
2. CLOSE-08 执行真实 controller，受控 Electron API 只模拟边界。明确断言两次 `dipToScreenRect` 都传实际 owner 和宽高 0 的原点矩形；同 bounds/scale、换算结果改变时重绘并使用新相位；相位不变不重复生成 bitmap。另测同 DIP bounds 但 OS scale 改变时 shape 重设，normal↔max 的 window/view/shape 高度同步。测试两项缓存条件不得合并成只改 bounds 就能通过的用例。
3. 最大化鼠标顶边 y=content.y 应白色，normal top−1、right/bottom 边界及关闭区外应回主题色。已有同 bounds/cursor 隐藏恢复、enabled=false、modal、fullscreen、主题 setter、moveAbove owner ID、closed 后所有 timer/listener/WeakMap 清理断言保留。
4. 更新既有 CLOSE-02/03/04/05/06 中旧几何、图像首像素和宽高假设。整个 cell 顶角现在透明，主题/hover 色断言须检查 glyph 非零 alpha 像素；不能因首像素 alpha=0 令颜色断言虚假通过。有限替身记录实际 view bounds/shape 调用，新增 screen API 支持限于相关 fixture，不扩大业务 no-op 范围或删除业务断言。
5. 在旧生产实现上保存新几何/相位/shape/hover 顶边的实质 RED；缺 helper、缺 API 替身、构造错误、EPERM 不计行为 RED。本次机械像素比较是实施后的缺陷定位与修正依据，不能改称最初视觉 TDD 红灯。

## 真实系统与运行来源

最终包同一版本需成对无装饰/有装饰原图或等价干净原生基准，normal/max/restore 对齐并加粗；继续真实红 hover、原生最大化/Snap/关闭、模态取消/恢复、缩放/焦点/快速离开、整个实际钳制窗口透明和穿透、正常退出及草稿重启可查看。每组关联 sourceHash、scale、cell、实际 decoration/content/view bounds 和相位；实际输入与 driver exit 来源不能仅用控制器 fixture 或日志 stage=closed 推定。单机器 DPI 不作为跨 DPI 实测，草稿持久保留不改称直接正文 DB 覆盖。

ALIGN 与 Web/mac 浏览器回归保留；新几何改动须关联最新目标测试、类型/构建、完整 core/browser、最终包 main hash 和原生样本。修正前完整 core 1739/1608 pass/123 fail/6 cancelled/2 skipped 保留为历史失败运行，不与新结果拼接或冒称全量通过。正式台账仅按真实覆盖更新，未执行仍待验收。
