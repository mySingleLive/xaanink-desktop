# 窗控重叠与宣纸悬停反馈技术方案独立审核

日期：2026-10-10。阶段：技术方案审核。结论：**通过，可进入测试用例独立审核。下述同步顺序和几何检查为实施与测试的必需约束；本结论不表示当前实现或原生效果通过。**

## 范围与依据

已确认并完整阅读 `docs/reviews/2026-10-09-window-controls-followup-plan.md`。只读检查真实 `src/components/layout/ChatPanel.tsx`、`ContentTabs.tsx`、`DashboardShell.tsx`，`src/app/globals.css`、`desktop.css`，`src/components/desktop/DesktopApp.tsx`、`WindowControls.tsx`，`desktop/main/window-appearance.ts`、`index.ts`、`root-maintenance-window.ts`、`root-relocation-window.ts`，及 `docs/implementation-boundaries.md`。仅新增本审核记录，没有改实现、测试或其他审核文件，没有执行原生 UI 操作。

命令依据：读取方案全文；`rg -n -C 5 'minSize|contentHidden|ChatPanel|defaultSize|zoom' src/components/layout/DashboardShell.tsx`；定位三个真实顶栏、安全区 CSS、`nativeTheme`、实际 `send`/`refreshMenus`/`createWindow` 接入；读取 `DesktopApp` 的主题事件与根字号应用。保留上一轮所有工作区修改。

## 结论与必需约束

1. **重叠原因具有真实源码依据，待原生几何确认。** `ChatPanel.tsx:1666` 的顶栏只有 `px-3`，`:1690–1699` 的真实恢复按钮含 `PanelRight`，没有右侧 caption/menu 安全区。`ContentTabs.tsx:73–78` 已使用 `max(env 几何, 138/zoom) + 40px`。透明覆盖层显露下方图标符合截图，但仍是待实测的原因假设。添加同一平台安全间距、保留原按钮和事件，符合批准的桌面差异及真实 Web 组件复用边界。

2. **窄窗与缩放须用二维几何核查。** `index.ts:665` 的最小原生宽度为 760；`DashboardShell.tsx:475–479` 的窄屏导航及 `globals.css:2108–2141` 的 899/679 CSS 断点会改变哪个面板可见及顶栏的纵向位置。因此不能只按 `contentHidden` 或横向坐标宣布按钮在 caption 下。覆盖内容隐藏/展开、侧栏显隐、有消息/无消息、最小窗口与常用窗口、五档 zoom 和三档 UI 字号；检查真实恢复按钮、固定菜单和 caption 的矩形交集、恢复按钮可点击且没有裁出窗口。标题已有 `min-w-0` 与 `truncate`，优先保留该压缩方式，不能删除恢复入口或重写分栏来规避宽度问题。

3. **既有菜单回退仍需核实。** `desktop.css:10` 的固定菜单位置使用 `env(..., 138px)` 回退，未包含 `138/zoom` 下限。在 env 未提供而 zoom=.75 时，菜单回退的物理间距会缩小，可能与原生 caption 相交。ChatPanel 的新 padding 可保护恢复按钮，却不自动证明菜单本身安全。测试应记录 env 是否可用和真实 x/y；若实际复现，应在本次同一安全区范围内统一算式，不能把复制既有表达式当成所有布局已通过。

4. **themeSource 同步方向成立，但为进程级设置。** [Electron nativeTheme 文档](https://www.electronjs.org/docs/latest/api/native-theme) 明确 themeSource 为 system/light/dark，显式设置会影响 `shouldUseDarkColors`、Chromium/native UI 及 `updated` 事件。paper→light、ink→dark、system→system 与当前应用选择一致，不会修改 Windows 的系统设置；影响范围也不限于该窗口的按钮。须核对主窗口其他原生菜单/对话框没有意外主题反转。维护与重定位入口本来与工作台隔离、body 使用静态有效主题，按各自快照设置该进程主题源合理，不新增热切换订阅或数据访问。

5. **必须先提交选择，再设置源，随后重新读取有效暗色值。** 当前 `applyMainWindowAppearance`（`index.ts:598–600`）先将 `nativeTheme.shouldUseDarkColors` 采样成 helper 的 boolean 参数。若新 helper 随后赋 themeSource，paper/light→system 且系统深色时，该参数仍为 false；同步 `updated` 重入即使内部算对，外层也可能用旧值覆盖。实施必须先经过现有 revision 门更新已提交选择缓存，再 guard 赋 themeSource，赋值后重新读取 `shouldUseDarkColors`，据此计算/应用/广播。构造器也必须先建立已提交缓存与主题源，再取当前有效值；否则首次设置源触发的回调可能仍以默认 system 或上一窗口选择反向修改源。无窗口时主题源与缓存仍须同步，窗口判空/销毁保护仅阻止窗口 API 调用。旧 revision 不修改缓存或源，同 revision 重开继续允许应用。

6. **事件与测试应验证实际接入。** `index.ts:303–307` 的 updated 注册顺序保持在创建/加载窗口之前；`send` 的真实 state 入口与 `refreshMenus` 的 revision 门继续作为唯一已提交状态来源。测试需覆盖 source setter 同步触发 updated 和延后触发两种情况、同源无重复赋值、显式主题抵抗系统事件、两种系统底色下往返 system、首次 constructor、同 revision 重开、旧 revision 及空/销毁窗口。helper 保持无 Electron import 的窄 adapter，避免冷启动路径新增模块初始化副作用。`DesktopApp.tsx:114,144` 的 `systemDark` 当前用于解析 system；强制 light/dark 后事件值代表有效原生颜色，不能在证据中标成独立读取的 Windows 原始主题。返回 system 后必须广播重新采样的值，避免 renderer 继续保留强制主题时的布尔值。

7. **hover 的上游依据只支持实施假设。** [Electron PR #48568](https://github.com/electron/electron/pull/48568/files) 的 `WinCaptionButton::GetBaseForegroundColor` 从 ColorProvider 读取活动/非活动前景，普通按钮背景使用该前景混色；这解释了为何只改 overlay symbolColor 不足以保证 hover。当前本机二进制仍须真实观察 paper 对深色系统的最小化/最大化 hover、非活动窗口、关闭红色反馈，以及 ink/system。继续保留透明色与 44px，不以不透明背景掩盖恢复按钮。

## 验证边界

方案按 AGENTS 指定顺序执行。受控 DOM/系统事件与原生 Windows 截图单独记录；浏览器模拟不能替代 native hover，网页截图不能单独证明原生按钮。新一轮隔离合成数据原生验证由主代理执行。本审核未恢复任何 UI 输入。

上一轮全量失败、超时和未执行项目保留，本轮新增验证不覆盖它们；W03/W04 正式状态不提升。打包资源探针不能替代安装包真实离线启动。当前只批准进入测试清单审核，待实际代码接入再复审上述顺序与副作用。
