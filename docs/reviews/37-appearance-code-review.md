# 外观设置与原编辑器接线独立代码审核

日期：2026-10-07（Asia/Shanghai）。范围：`AppearanceNumber.tsx`、`src/lib/desktop/appearance.ts`、`SettingsDialog.tsx` 外观页、`DesktopApp.tsx` 外观变量、原 `MonacoMarkdownEditor.tsx` options 与 `MarkdownEditor.tsx` 预览作用域、`desktop.css` 正文覆盖，以及 main 的 local-fonts 权限和保存/启动 zoom。定向阅读实际设置 store、原评论 hook、安装的 Monaco React 包和已批准外观契约。CodeGraph 当前不可用，采用已定位源文件阅读。

实现及真实 Electron 运行由主代理完成。复审代理按授权只新增 `tests/unit/appearance-settings.test.ts`、本报告及对应 RED/GREEN 文件，没有修改产品实现、启动/重建 App 或控制浏览器。

## 最终结论

**本批有限范围代码审核通过。** AP37-01–03 已修复，范围内没有待处理阻断。独立受控回归 5/5 通过，原生外观结果由主代理执行、子代理复核脚本与文件。结论覆盖本批外观接线，不代表 Windows、全部设置、编辑器完整保护契约或正式桌面验收完成。

## 问题与闭合

| 编号 | 发现及修复前证据 | 修复与独立复核 |
| --- | --- | --- |
| AP37-01 · 已闭合 | 子代理源码发现并以真实 TSX 受控回归复现：确认值 14，输入 24 已发起保存，Escape 恢复 14 且清 dirty；迟到保存确认 24 时，focused 守卫使输入继续显示 14，直到失焦。RED 第 1 项实际为 `14 != 24`。 | 去掉 focused 状态，只让未提交的 dirty 草稿阻挡确认值同步。Escape 不伪称撤销已经派发的保存，而是恢复当前确认值并屏蔽旧错误；后续确认到来时仍能同步。相同回归 GREEN 通过。 |
| AP37-02 · 已闭合 | 子代理源码确认：成功枚举字体后，已保存但本机缺失的 family 被直接补入下拉，CSS 静默回退，没有不可用标记或回退提示。不符合已批准的字体回退说明。没有冒称修复前原生 GUI 已复现。 | 成功枚举后通过 fontsLoaded 与 family 列表判定缺失；保留原 option/value、标记不可用，界面提示 system-ui，正文提示可用衬线候选或 serif 及缺字回退。枚举失败提示仍与确认“字体不存在”分开。独立源码复核闭合，主代理最终原生脚本另断言缺失 UI family 仍被选中及界面/正文两处回退提示；不把 CSS 字体声明或候选列表称为每个字形实际渲染字体的验收。 |
| AP37-03 · 已闭合 | 子代理使用实际 Zustand store 与受控 IPC Promise 复现：16 和 18 先后排队，16 写失败、18 写成功，确认值已为 18，但顶层 error 仍显示首次失败。RED 第 5 项实际为旧错误字符串而非 null。 | 串行写入的成功确认分支清除 error。回归证明失败回读后第二次按最新状态保存，最终值 18、saving 为 0、旧错误消失；没有用新的乐观值遮盖失败。GREEN 通过。 |

`docs/evidence/implementation-03/appearance-number-review-red.tap` 在上述数字与 store 修复前保存，5 项中 3 通过、2 失败；同名 GREEN 文件为最终 5/5。组件移除 onFocus 后，测试的原生 focus 模拟改为可选调用已有 handler，行为断言没有放宽，也未为了 harness 给产品添加多余事件。

另有主代理实际 Electron 的默认行号 RED：原 Monaco 默认仍显示行号。`appearance-red.json` 保留真实失败，修复以保存配置显式控制 lineNumbers，后续原生脚本验证默认隐藏及打开后可见。其他取景/测试操作过程中的失败文件不计作新的产品缺陷或已完成正式用例。

## 接线与状态边界

数字输入保留空值、范围外与非整数字号草稿，先校验再调用保存；失焦给字段级可访问错误，失败保留待处理输入，重新输入可重试，Escape 清当前草稿错误并恢复确认值。edit revision 阻止旧 Promise 的失败/完成覆盖新草稿。独立测试涵盖空/越界/非整数不派发、浮点行距、旧失败与新草稿隔离、失败保留/重试/Escape，以及两次串行写中前失败后成功的状态。非法/失败值没有通过 DesktopApp 乐观应用到工作台。

本机字体通过用户打开外观页触发 queryLocalFonts，去重/排序，不发下载请求；通用字体和缺失的历史字体均可展示。自定义 family 清控制字符并转义反斜线/引号，再接通用 fallback 链。main 的权限请求与权限检查都限定为当前 BrowserWindow 的受信主 frame、`xaanink://app/` 和 local-fonts，其他窗口/frame/权限拒绝。权限负例是源码审查，没有冒称运行了恶意 iframe/其他窗口的权限测试。

DesktopApp 以确认快照更新主题、界面 family、root rem 字号、正文 family/字号/行距变量；原 DashboardShell 保持挂载。native zoom 在仓库成功提交后设置，并在创建窗口时读取保存值。当前原生脚本验证保存后 getZoomFactor 为 1.25；启动恢复分支经源码复核，不将同一进程的检查扩张为重启验收。

原 Monaco 的 value、onChange、onMount、模型、评论 hook 均继续复用；外观只传入 options，保持原编辑实例。安装的 `@monaco-editor/react` 对 options 更新调用现有 editor.updateOptions，没有因本次字号/行距/换行/行号引入 key、setValue、dispose 或新建 editor。默认关闭自动换行和行号；行号仅源码，预览不增加 gutter。字体/字号/行距作用于原编辑器及 `.desktop-markdown-editor .markdown-body`，不会把 AI 对话或其他 Markdown 显示区域统一改为正文设置。原 MarkdownEditor 仅增加作用域 class，评论 decorations/ViewZone/ResizeObserver 和布局监听没有替换。

这证明本次接线保留原实例与数据通路，不能仅凭未改原 hook 就宣布所有选区/评论锚点已通过真实场景验收。原生 smoke 已验证插入内容与一次撤销跨外观更新保持；尚未实际断言非空选区、展开评论/回复草稿和锚点位置，留给正式对应场景。

## 验证与证据来源

独立 Node 24.18.0 执行：

```text
node --import tsx --test --test-reporter=tap tests/unit/appearance-settings.test.ts
tests 5, pass 5, fail 0, cancelled 0, skipped 0
```

添加测试后的 `tsc --noEmit --incremental false --pretty false` 独立通过，未写 tsbuildinfo/App 构建产物。组件测试以内存转译执行真实 TSX，以可控 hooks、公开 input value/aria-invalid/alert 和延迟 Promise 断言；store 项执行实际 store 并替换 IPC。它们不模拟 Chromium number input 默认行为、真实磁盘故障、Base UI 焦点动画或 OS 字体。

主代理运行 `scripts/smoke-electron.mjs --appearance`，通过 `scripts/smoke-appearance.mjs` 启动真实 macOS 开发 Electron，隔离本地数据目录并使用实际作品、章节与原 Monaco。最终 `appearance-latest.json`（11:31:17.862Z–11:31:26.042Z）为 9 组检查通过、errors 为空：包含默认正文 16px/无行号、缺失字体保留及双提示、本机字体枚举选择、空字号不写入、native zoom、正文 family/20px/40px 行距/换行/行号更新与旧 editor DOM 保持、输入草稿和撤销、原预览字体且无 editor 行号。另一个组是暂存编辑/撤销没有显示假修订冲突的附带观察；其实现边界由第 38 份审核另行审查，未据这一条扩展本次通过范围。复审代理只读取结果和核对脚本，未独立重跑原生窗口；单元竞态修复不因 smoke 通过而跳过。

原生证据的动作由 Playwright Electron/CDP 驱动，没有把它称为物理键盘/IME、Windows、安装包或真实用户全流程验收。取景曾在 native zoom 下出现 Playwright 截图裁切，主代理改用 BrowserWindow.capturePage。子代理查看最终 `native-appearance.png`，完整窗口和三栏可见；JSON 的 innerWidth/clientWidth/scrollWidth 均为 1152，各面板矩形在视口内，右栏 right 为 1152。这只证明外层面板边界，不能推断内部控件都可达：当前 16px 界面字号加 1.25 zoom 的窄右栏工具条明显拥挤，完整缩放/响应式布局验收仍未通过本记录完成。

该 PNG 的合成帧仍显示带行号的编辑画面；同次脚本已通过预览 DOM 存在、正文排版属性和 Monaco 数量为 0 的断言。截图不是预览切换完成后的像素证据，两者不混用。主代理说明后续会等待渲染帧后取景；本次仅以该图复核完整窗口与取景边界，预览行为依相应 DOM 断言。旧裁切图也不用于推断工作台实际越界。

其他批次的模型服务、正文暂存版本冲突、快捷键执行路由及菜单动态同步不纳入本次通过范围。本记录没有合并旧原型证据、累加其他模块用例，或把正式顶层测试用例标为通过。
