# 有 Tab 顶栏追加 code review

日期：2026-10-10。结论：**通过，未发现本追加范围的阻断代码问题。** 已读取关联回归最终 footer：18 tests / 18 pass / 0 fail / 0 cancelled / 0 skipped；本结论不代替新版 Windows 原生及完整响应式验收。只新增本文件，未修改产品、测试、旧审核或其他人的修改，未执行原生 UI 操作。

## 精确范围与原断言核查

依据已通过的 populated-tabs 追加技术/测试审核，只读审核 `src/components/layout/ContentTabs.tsx` tablist 新平台 style，`tests/browser/empty-content-hide.test.ts` 的 railSafe/WCO-S04/WCO-S05，以及 `tdd-tab-red.log`、`tabs-green.log`。命令包含上述文件的 Git diff、源文件读取、日志读取。

**没有误改原 EMPTY-05。** Git diff 仅在测试文件原结尾追加 helper 与两个新用例；将当前文件及 `git show HEAD:tests/browser/empty-content-hide.test.ts` 归一化换行后，当前文件保留整个 HEAD 前缀，比较结果 `AllExistingTestPrefixUnchanged=True`。原 EMPTY-05 的最后断言仍为 `["fullscreen", "hide"]`，不是新 S05 的 `["fullscreen", "fullscreen", "hide", "hide"]`。原空态与 macOS 回归没有删改或削弱。

## 实现审核

`ContentTabs.tsx:95–98` 仅在真实 role=tablist 上为 win32 增加与空态一致的 env/138÷zoom 下限+40px右 padding和 `justifyContent:"flex-end"`。没有改真实 tabs 映射、滚动容器/ref、选择/关闭/全屏/隐藏事件、store、内容实例或 Web/macOS style。正常剩余空间仍由原 flex-1 scroller占用；负剩余宽度时控制组右边界保持在保留区左侧，溢出转向左侧，符合批准的修复目标。

容量不足仍为明确限制，不表示两按钮和所有 Tab始终完整处于极窄pane内。没有以不透明背景遮盖按钮、删控制入口或重写 DashboardShell分栏来规避。实际最小工作台的包装、裁剪和按钮可达性由新版原生验证承担。

## 新用例与证据真实性

- S04继续使用实际 import的 ContentTabs/WindowControls与生产CSS；仅无关业务body受控。1/20 Tab、280/360/440 CSS pane、三档zoom、三档UI字号、env0/106/138/184/216组合都执行DOM几何。菜单自己先与保留区分离，两个原按钮分别与菜单严格分离，足以证明该受控布局没有二维交集。
- railSafe 使用实际 header宽度、computed左右padding、每个button宽度及左右margin分类容量。容量足够才断言两按钮均在pane内，不再假定360px总能容纳env216/font24。容量不足仍执行右缘安全断言，没有把该组合略过或称为inside通过。
- env对照只将外部env读取替换为夹具变量，未复制或改写实际安全区算法；caption=0移除变量并回到原fallback。动态zoom/font通过原bootstrap订阅和root字号输入进入组件。
- S05在足够容量的440px/默认字号场景使用普通点击、Space、Enter，无force click或DOM click。检查原fullscreen回调、隐藏后pane卸载、夹具恢复后Tab保留、关闭最后Tab出现原空态隐藏按钮。恢复控件本来就是明确夹具；fullscreen prop仍为受控false，因此验证的是事件接入，不是原生实际全屏/退出动画或完整Dashboard草稿持久化。
- `tdd-tab-red.log` 两个用例都失败于产品几何，而非启动/解析错误。S04旧控制right约1071.73/1093.72，菜单left882；S05旧控制right1064/1092，菜单left928。它们实际执行旧tablist，支持本次修复的红灯依据。
- `tabs-green.log` 已出现最终18/18 footer，S04、S05及原EMPTY-05均通过；原ChatPanel安全区、空态及DRAG-03真实tab滚动/激活显示回归也通过。该记录只是受控浏览器回归，不是原生ColorProvider/hover、899/679真实导航y或macOS目标系统验收。

## 后续验证范围

修改后需重新类型检查、生产构建和Windows打包，再核对新产物的实际有Tab/空态、760px及 .75/1/2 zoom、真实pane隐藏/恢复/全屏与caption/menu的二维关系。之前 `packaged-wide-075-tab.png` 是问题基线，不是修复后证据。

原核心和首次全量browser失败/取消继续保留，本追加记录不覆盖或更改它们的统计，也不将W03/W04正式状态提升。原生未执行组合、容量不足的用户可达性限制、物理Escape中止及离线范围需继续据实记录。
