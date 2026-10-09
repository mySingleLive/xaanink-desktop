# 有 Tab 顶栏追加方案与测试清单独立审核

日期：2026-10-10。本记录依次完成追加技术方案审核、追加测试清单审核。**两阶段通过，可开始本追加范围的 TDD 红灯，再实施及独立 code review。** 未修改产品或测试，未执行原生 UI 输入；只新增本审核记录，保留此前所有修改。

## 第一阶段：追加技术方案审核

完整阅读 followup-plan 的“原生检查发现的同一问题：有 Tab 顶栏”，只读检查真实 `ContentTabs.tsx`、相关 DashboardShell/响应式 CSS 和当前 Windows 菜单位置，并查看已有 `docs/evidence/window-controls-followup/packaged-wide-075-tab.png`。截图右上角的面板控制与 caption 位置相邻/重叠，和真实源码对应：空态 `ContentTabs.tsx:73–78` 有安全区，但 `role=tablist`（`:91–95`）没有；其末尾全屏/隐藏按钮（`:158–184`）为固定尺寸、`shrink-0`，原 tab scroller 为 `flex-1 min-w-0`。

追加仅在真实 Windows tablist 接入与空态一致的右 padding，沿用 env 与 138÷zoom 下限及 40px 菜单间距；没有新造 Tab 组件、替换业务 body 或改变 store/events。给该行 Windows `justifyContent:'flex-end'` 可让剩余空间不足时控制组保持右侧边界、溢出转向左侧，而非继续伸入 menu/caption。Web/macOS 不增加该 style，保留真实 tabs、ref、scroll observer、关闭/全屏/隐藏事件及所有原内容实例。范围符合桌面安全插槽微调，不涉及原分栏重写。

**容量约束必须保留。** 不足的 pane 无法同时容纳右保留区、两个固定按钮及边距；该方案解决右缘重叠，不额外保证极窄状态的左侧全屏按钮/Tab 始终位于 pane 内或完整可点击。按真实 computed 值判断容量，不能只根据 pane 宽度标签。例如 .75/fallback 时右 padding=224px；font14 左 padding=8px、两按钮及 ml 合计56px，280px pane 已不足8px。font24 控制组约96px、左 padding约13.7px，不足更明显。常规 fallback 的360px可容纳这些组合；若 env216 与 font24同时模拟，需求约256+13.7+96=365.7px，360px也略不足。实际最小760px工作台需单独原生验证，不能从独立 pane fixture 推断其包装/y或鼠标可达性。

第一阶段结论：**通过。** 实现严格限真实 tablist 的平台 style；如果原生最小工作台仍出现实际按钮不可达，保留事实并再分析安全插槽范围内的调整，不能用 force click、删除按钮或重写分栏掩盖。

## 第二阶段：追加 WCO-S04/S05 测试清单审核

在技术方案通过后，完整读取 followup-test-cases 的 WCO-S04/S05 追加段，并核对 `tests/browser/empty-content-hide.test.ts` 现有 fixture：实际 import ContentTabs、WindowsMenuControl、SidebarWindowControls 和生产 CSS，真实 tabs store；无关业务 body 受控，恢复按钮为明确夹具。该来源适合验证本次布局和事件接入，不能充当全部业务或完整 DashboardShell。

追加用例覆盖 1/20 Tab、280/360/440 CSS pane、.75/1/2 zoom、11/14/24 UI字号和 env106/138/184/216；同时检查两个真实原按钮、固定菜单及 native 保留区的矩形关系。容量足够时断言按钮均在 pane 内，容量不足时仅断言右缘安全并记录边界；env注入只替换外部 env 值，不重写安全区算法。该矩阵可揭示只加 padding、却让负余宽仍向右溢出的错误。

测试实施必须维持以下具体约束：

- 红灯执行当前尚未添加 tablist style 的真实组件，失败于按钮/menu/caption 的几何断言；浏览器启动超时、解析或缺依赖继续单独记录，不算产品红灯。
- capacity 使用当前 computed padding、按钮/边距推算；所有 env/字号组合都按实际容量分类，不能预设360必定充足。两个按钮分别验证，不只检查最后的隐藏按钮；固定菜单自己也要在保留区外。
- 1 Tab在足够容量时通过普通点击/键盘验证原全屏回调、隐藏/夹具恢复后 Tab 保留，并关闭最后 Tab后出现原空态隐藏按钮；不得通过直接修改 store、force click 或 DOM click 宣称真实用户能点击受裁剪按钮。回调测试不等于 DashboardShell 的全屏动画、真实恢复入口或 editor 状态全部通过。
- 20 Tab 保留实际 scroller/选择/关闭入口；Web/macOS 原回归保留。测试不得删真实 tab业务逻辑、弱化原断言或重建示例 Tab 组件。
- N02再次使用真实新版原生工作台，包含最小760px及 .75/1/2 zoom，有 Tab/空态、隐藏/恢复与原生 caption/menu，以实际899/679导航变化核查二维交集；缺机器/中止/未执行保持未执行。修改后重新构建及打包，之前包截图不代表修复后的产物。

第二阶段结论：**通过，可执行追加 TDD。** 上述容量和 fixture 限制与清单声明一致。此时尚未运行新用例，也不宣布截图中的问题已修复。此前全量失败及 W03/W04 正式状态继续保留，不能由这两项追加用例覆盖。
