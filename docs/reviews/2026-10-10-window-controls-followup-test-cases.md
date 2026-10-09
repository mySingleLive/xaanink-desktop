# 窗控重叠与悬停反馈回归清单

前置：followup-plan 独立审核通过。日期：2026-10-10；只覆盖用户报告问题及其接入影响。

## TDD 自动回归

1. WCO-F01：执行实际 main 的 state dispatch、revision gate、applyMainWindowAppearance/nativeTheme updated，注入真实外观 helper 与最小原生端口。paper/ink/system 正确设置 themeSource，source setter 后才重新采样 dark；paper→system 且 OS dark、ink→system 且 OS light 都回到正确 foreground/background。
2. WCO-F02：themeSource setter 同步触发 updated 时不重复赋值、不递归、不被外层旧 dark 覆盖；另按真实 callback 队列回放延后 updated，切换 paper→ink 后的早期事件仍应用当前选择，最后广播 dark 与当前 source 一致。旧 revision 不改 source，同 revision 的新窗口仍应用；null/销毁窗口仍允许缓存/native source 同步但不调用窗口 setter。
3. WCO-F03：提取并执行真实 main 构造前的 state/read/appearance/options 语句，以及真实 refreshMenus/updated；缓存先更新，source 同步先于 constructor，system 的 constructor 使用赋值后的 dark。维修/重定位实际模块的受控 nativeTheme port 增加 source getter/setter，记录 constructor 当次 source；新增 source 先于 constructor 且与传入 body 有效主题快照一致的断言，显式 paper 对暗系统及 ink 快照均覆盖。复跑原有隔离、数据安全、生命周期断言；仅复跑固定 shouldUseDarkColors 的旧 fixture 不算新增同步验证，受控模块仍不称原生界面。
4. WCO-F04：共享 helper 不 import Electron，只经窄 themeSource adapter 同步并守卫相同值。保留透明 overlay、44px 高度和符号令牌回归。
5. WCO-S01：浏览器执行当前真实 ChatPanel header JSX 和真实 WindowsMenuControl、生产 CSS。内容隐藏时恢复按钮及 menu 的 DOM 矩形与原生保留区无二维交集。遍历 760/1440 物理窗口的 CSS viewport=width/zoom，zoom .75/1/1.25/1.5/2、UI font 11/14/24、侧栏显隐。提取 header 不能覆盖 DashboardShell 的 899/679 响应式包装，实际纵向变化留给 N02，浏览器结果只声明受控顶栏几何。
6. WCO-S02：浏览器未暴露 WCO 时测 fallback；注入 env 返回矩形仅用于受控 CSS 几何，分别检查 caption 106/138/184/216px（CSS 单位）与 zoom 下限。菜单自己也不得进入 caption；如红灯出现，仅修正该菜单 zoom 安全区。
7. WCO-S03：点击及键盘恢复内容保持原有 callback；内容展开后 ChatPanel 释放右侧间距。Web/macOS 保持原右侧布局及 macOS 左侧 traffic-light 保留。复跑既有 sidebar-restore、pane-window-drag、empty-content-hide 用例。

追加 WCO-S04/S05：原生有 Tab 截图复现后，浏览器使用 existing empty-content-hide 的实际 ContentTabs+WindowControls fixture，加入 win32 populated rail 用例。两原按钮与菜单/caption 无交集，1/20 tabs、280/360/440 CSS pane、zoom .75/1/2、font 11/14/24；模拟 env 106/138/184/216。若 CSS pane 连保留区+控制组都容不下，单独验证右缘安全并注明容量，不能称两按钮都在 pane 内。1 Tab时全屏原回调仍调用，隐藏/恢复保留标签；Web/mac原测试保留。实际窄窗 y 与常用设置检查仍走 N02。先红灯，最小 Windows tablist style 接入后绿灯及独立追加审查。

先记录以上在旧代码的实质红灯，非 harness 解析/依赖错误不能替代产品红灯。新增测试只解析/执行实际来源，不启动作者 I/O，也不把浏览器/ports 当原生验收。

## Windows 实机与构建

8. WCO-N01：使用全新隔离合成夹具，真实 Web 工作台 + Electron 44.6.0。原生截图分别证明 paper 正常、最小化与最大化 hover 清晰，close 正常只有 X、hover 保留红底；非活动窗口符号保持可读，并检查原生应用菜单显示及正常项仍可用的主题副作用。
9. WCO-N02：设置 UI 切换 paper/ink/system；真实内容隐藏/展开与空/有 Tab、宽窗及最小 760px、缩放 .75/1/2 时恢复入口与 menu/caption 无交集且可点。窄窗真实 y 区按实际导航变化检查，不只比 x。
10. WCO-N03：实际原生最大化/复原、最小化/恢复、正常关闭和隔离重启。新版解包应用在本地 xaanink 协议、renderer CDP 离线条件下启动，范围限定窗控。本机 OS 主题不修改；若控制 Electron themeSource 驱动对照，明确标为受控源切换，不冒充 OS 设置改变。
11. TypeScript、生产构建、Windows 打包与资源/依赖探针；核心全部活动 unit/integration 及 browser 全量执行，采用明确并发和每文件超时避免无限挂起。失败、取消、skip 原样记录，不能将已知失败过滤或称为通过。

原生输入只用 computer-use。物理 Escape 若再次中止则停止本轮原生操作并据实保留未执行；不能从单张 screenshot 或受控事件推出所有窗口状态通过。W03/W04 正式状态仍 planned，仅追加有限开发证据。
