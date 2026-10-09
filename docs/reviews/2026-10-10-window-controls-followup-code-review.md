# 窗控重叠与悬停反馈独立 code review

日期：2026-10-10。结论：**本轮实现审核通过，未发现需阻断修复的代码问题。关联测试有两项失败，当前不得宣称全量或原生验收全部通过。** 本轮只新增本审核文件，未改产品、测试、先前审核或其他人的修改，未执行原生 UI 操作。

## 审核范围

依据已通过的 followup 技术方案及补充测试清单，只读审核 `desktop/main/window-appearance.ts`，`index.ts` 的外观同步/revision/构造前语句与 updated 接入，两个 cold 窗口；真实 `ChatPanel.tsx` 顶栏、`WindowControls.tsx` 与 `desktop.css` 菜单位置；`window-native-theme-source.test.ts`、`window-appearance.test.ts`、两个 cold 模块测试的新同步用例，以及 `chat-caption-safe-area.test.ts`。保留上一轮透明背景修复和数据安全断言。

核对方式：读取上述源文件与 Git diff，查看红灯和关联结果日志；将 `chat-header-baseline.tsx` 与 `git show HEAD:src/components/layout/ChatPanel.tsx` 归一化换行后比较，结果一致。独立执行主进程新同步回归，命令及结果见下文。

## 代码与接入结论

1. **同步顺序满足复审约束。** `index.ts:602–608` 先拒绝旧 revision，再提交 revision 和主题选择缓存，随后调用外观同步。`:598–601` 先 guard 设置 nativeTheme source，随后重新取 `shouldUseDarkColors` 传给真实窗口 helper；没有将旧布尔值跨过 source 赋值。updated 回调在创建/加载窗口之前注册，应用当前缓存主题后读取有效 dark 并广播。同步 setter 重入时 source 已等于目标，因此不重复赋值；延后回调也读取当前缓存，不闭包捕获旧设置。

2. **构造与窗口生命周期安全。** `index.ts:664–667` 的真实 read 后、constructor 前先执行 `refreshMenus(state)`，建立缓存与 source，再计算窗口选项；constructor 后仍保留刷新，因此同 revision 重开继续应用。source 同步在窗口 setter 的 null/销毁 guard 之外；无窗口时也能同步已提交选择。窗口的原 closed、owner 清理、关闭协调与隔离流程未被改写。

3. **helper 的边界清楚。** `window-appearance.ts:10–14` 只有窄 themeSource adapter 和值比较，唯一 import 为 type Settings，没有 Electron 或数据服务初始化。paper/light、ink/dark、system/system 映射正确。背景、真实 foreground、透明 `#00000000` 及 44px 保留；`applyWindowAppearance` 仍只在 win32 调用 overlay setter，其他平台不新增自绘窗控。代码仅设置 Electron 应用进程主题源，没有修改 Windows OS 设置的调用。

4. **冷启动窗口匹配静态 body 快照。** 维护窗口仍从原有隔离 metadata 流程取 paper/ink；重定位仍在独立入口取有效系统快照。二者均在 constructor 前同步 source，再计算原生选项，继续传同一主题给 runner/controller。没有新增实时主题监听、工作台服务、源 session、模型 Key 访问、网络服务或任意颜色 IPC。

5. **恢复按钮与菜单修复沿用真实组件。** `ChatPanel.tsx:1666–1671` 只增加 win32/contentHidden 的顶栏右间距，表达式沿用真实 ContentTabs 的 env/138÷zoom 下限和 40px；原按钮、PanelRight、回调、flex、消息标题及 macOS 左侧保留区不变。`WindowControls.tsx:18–21` 从真实 bootstrap 订阅 zoom，在现有菜单按钮上设 CSS 变量；`desktop.css:10` 增加相同 zoom 下限。未引入设计预览或第二套窗控，修改局限于批准桌面安全间距。

## 测试真实性与证据

- 新主进程 fixture 提取 actual send、refreshMenus、applyMainWindowAppearance、updated 和构造前语句，注入实际外观 helper；source getter/setter 影响有效 dark，既有同步事件也有延后队列。断言包含显式选择、两种返回 system、source 单次赋值/重入、旧 revision、同 revision 重开、null/销毁窗口、constructor 当次 source/符号和缓存。构造前测试只执行选定语句，不能代表整个 Electron startup，但可验证本次接入顺序。
- `window-appearance.test.ts` 旧入口 rig 加入真实 source helper 注入，保持原调用断言；该旧 rig 的 dark 仍是人工端口值，不能用它证明原生 ColorProvider。新 fixture 的动态 getter 覆盖 source→dark 的逻辑，真实效果留给原生验收。
- 两个 cold 新用例 bundle/执行实际模块，窗口 port 在 constructor 记录当次 source，并比对 runner/controller 快照及原文件未变。维护覆盖保存 paper 对深色系统；重定位遍历浅/深系统快照。新增端口没有削弱内存 session、来源路径、数据安全、关闭与 IPC 的既有断言。
- 浏览器测试使用当前真实 ChatPanel 顶栏 JSX、真正的 WindowsMenuControl、生产 Tailwind/CSS；env 对照仅替代外部值，安全区表达式仍来自源文件。五档 zoom、三档字号、两种窗口宽度及侧栏显隐执行真实 DOM 几何；菜单与 caption、恢复按钮与菜单严格横向分离，足以证明该受控布局没有矩形交集。点击/Enter/Space、重新隐藏、间距释放、Web/macOS 右布局均保留。fixture 为 messages=[] 的隔离 header，没有真实 DashboardShell 导航/Panel 包装、业务恢复动画或原生按钮，不能据此声明 899/679 响应式真实 y、全部消息状态、原生 hover 或 macOS 实机通过。

### 红灯范围

- `tdd-red.log` 中 8 个 F01/F02/F03 失败为实际 main 来源的 source/选项断言，属于产品逻辑红灯；同次 5 个 browser hook 启动超时属于环境失败，不计产品红灯。
- `tdd-cold-red.log` 两个真实 cold 模块在构造时仍为 system，期望 light，实际断言失败，不是解析/依赖错误。
- `tdd-layout-red.log` 在 .75 zoom 下菜单 x=1780、width=28，保留区 right=1736，菜单面积/间距断言实质失败；它先停于菜单断言，不能单独证明恢复入口红灯。
- 补充的 `tdd-restore-red.log` 使用可选 `XAANINK_CAPTION_HEADER_SOURCE` 执行真实 HEAD 旧顶栏和当前菜单。已验证隔离旧来源与 HEAD 一致；恢复按钮 x=1400、width=28，菜单 x=1268、width=28、caption right=1302，恢复按钮断言实质失败。该环境变量只被测试读取，不改变产品入口；这是独立旧源码回放的补充红灯，不能改变最初 browser 启动超时的事实或替代其执行记录。

### 绿灯及限制

独立运行：使用 bundled Node 24.19.0，并将其 bin 置于 PATH，执行 `node --import tsx --test --test-reporter=tap tests/unit/window-native-theme-source.test.ts`。结果 exit 0，**8 tests / 8 pass / 0 fail / 0 cancelled / 0 skipped**。只使用 ports/AST 与真实 helper，没有原生窗口或作者 I/O。

另已读取 `followup-green.log` 最终 footer：**15 tests / 15 pass / 0 fail / 0 cancelled / 0 skipped**，包含五个当前顶栏/菜单浏览器测试、八个 main source 测试和两个实际 cold 模块测试。该单独新增回归运行成功，不覆盖下述含失败的关联运行。

`targeted-green.log` 的最终 footer 为 **72 tests / 70 pass / 2 fail / 0 cancelled / 0 skipped**。本轮新增同步/冷入口/几何及关联 theme/安全区回归通过，但整次运行失败：

- RW33-01 保留 `/preload\/root-relocation.cjs$/` 与真实 Windows 反斜杠路径的断言失败。
- RW33-04 保留 `RELOCATION_COMMAND_NOT_COMPLETED`。本审核没有证明其具体根因，不以“基线”标签掩盖失败，也没有修改或跳过业务断言。

本次 code review 不将 70/72 改记全部通过。类型及生产构建结果由主代理另行记录；全量、Windows 打包与原生验证尚需依据各自最终结果记录。受控 themeSource 对照不冒充修改真实 OS 主题，renderer CDP offline 不等于系统全断网。W03/W04 正式验收状态维持原边界，未执行组合及物理 Escape 中止继续如实记录。
