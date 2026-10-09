# 窗控重叠与宣纸悬停反馈修复方案

范围：用户最新截图中的关闭按钮背后方框，以及宣纸主题的原生窗控 hover。保留上一轮未提交修改、真实 Web 组件、原生窗控与透明纸纹。

## 源码依据及原因假设

- `ChatPanel.tsx` 的真实“显示内容面板”按钮含 PanelRight，随顶栏 flex 排在最右；该顶栏没有 Windows caption/menu 安全间距。`ContentTabs.tsx` 空态已有 env(titlebar-area-width) + 138/zoom 回退 + 40px 的安全间距。透明 caption 将 ChatPanel 的图标透出，符合截图的方框位置；须用隔离真实窗口的 DOM 几何与原生截图验证。
- 上一轮仅同步 overlay.symbolColor，没有同步 Electron nativeTheme.themeSource。用户选择 paper 而系统为暗色时，Web/符号为浅色主题，原生 ColorProvider 仍采用系统暗色。Electron 上游 [hover 修复 PR](https://github.com/electron/electron/pull/48568/files) 用原生前景色作非关闭按钮 hover 的混合底色，而非 overlay symbolColor；[原问题](https://github.com/electron/electron/issues/48193) 描述透明 caption 的浅色反馈过淡。当前本机二进制行为须对照观察，不能仅凭上游记录声明通过。

## 拟实施

1. 在真实 ChatPanel 的顶栏新增 Windows 专属安全间距，仅当内容区隐藏、ChatPanel 到达窗口右缘时采用既有 ContentTabs 算式。保留按钮、事件、flex 结构与所有 Web 业务内容，不添加第二套窗控。检查最小窗口、缩放、字号及重新展开内容区。
2. 在共享原生外观 helper 增加 paper→light、ink→dark、system→system 的 nativeThemeSource 同步，使用值比较避免 updated 递归或无意义赋值。先经 revision 门提交缓存主题，再赋 source，赋值后重新读取 shouldUseDarkColors 才计算/应用/广播；无窗口也同步 source。构造前必须先提交缓存并同步 source，避免同步 updated 重新施用旧缓存。主窗口从已提交主题同步，系统模式恢复 system；系统事件仍使用当前原生值。Electron 应用内设置不会修改 Windows 系统主题。
3. 冷启动维修/重定位窗口保持既有主题快照与隔离流程，原生 ColorProvider 采用该窗口选择，和其静态 React body 保持一致；不增加数据访问、HTTP、任意颜色 IPC 或 UI mock。
4. 背景继续透明，44px 高度和原生关闭红色反馈不变。通过主题 ColorProvider 修正非关闭按钮 hover，不用不透明色块遮盖页面按钮。

## 原生检查发现的同一问题：有 Tab 顶栏

在新版实际 Windows 应用打开真实主题 Tab 后，`packaged-wide-075-tab.png` 显示 ContentTabs 的全屏/隐藏按钮也处于 caption 下方。空态已有安全区，但 role=tablist 未接入。追加范围仅限该真实 tablist 的 Windows 安全插槽：采用与空态相同的右 padding；Windows justifyContent=end 在控制组超过剩余宽度时向左对齐，保持右缘安全，不重写 tabs/事件/滚动/内容。Web/mac 不变。测试实际 ContentTabs 的 1/多 Tab、zoom/font/env、两按钮和菜单相对 caption 的几何，关闭最后 Tab/隐藏恢复/全屏原回调；极窄 pane 控制组容量限制单独记载，不能凭 header fixture 推出完整响应式。先独立审核此方案及追加用例，再红灯/实现/追加 code review。新构建与包需再次生成。

## 顺序与验证边界

方案独立审核 → 测试用例独立审核 → TDD 红灯 → 实现 → 独立 code review → 核心/浏览器活动测试、类型检查、生产构建/打包 → Windows 隔离实际窗口验证。

验证要覆盖：内容隐藏/展开后的恢复入口不与 menu/caption 重叠，.75/1/1.25/1.5/2 缩放和 11/14/24 字号；原生 paper 对暗色系统、ink、system，以及最小化/最大化/复原/关闭。浏览器几何检查和模拟系统事件明确为受控测试，真实窗口截图单独记录。全部失败/超时/未执行保留，W03/W04 正式状态不提升。

独立审核的额外约束：窄窗 899/679 的响应式导航会改变顶栏 y，应按实际二维交集检查；菜单 fallback 本身尚未用 138/zoom，测试若复现其与 caption 的重叠，须在同一安全区范围修正，不只移动恢复按钮。基线真实隔离窗口已读得：viewport 1440，caption 可用区 right=1303，恢复内容按钮 x=1400/right=1428，而菜单 x=1269/right=1297；`native-baseline.png/json` 支持恢复按钮进入 caption 区的判断。

仅实施本问题。上一轮全量存在数据恢复、导出及平台测试失败，不能将它们当成本轮通过。测试采用隔离合成夹具，不读作者数据或 Key；新包资源探针不能代替 Electron 原生离线启动。
