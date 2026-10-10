# 紧凑窗控最终独立证据审核

日期：2026-10-10（Asia/Shanghai）。审核范围为本轮有限 Windows 原生高度与菜单位置修复。仅写本报告，未修改产品、测试或主验证文档，未重新运行业务套件、GUI 或安装程序。

结论：**有限修复的证据审核通过，无新增阻断发现；全量验收仍未通过。** 来源支持本机观察到的原生三枚符号上移 6 个截图像素、32 DIP 配置及相关回归通过。全量失败/取消保留，不能据此宣布产品或双平台全部通过。

## 独立复核结果

读取本轮 verification.md/json、finalize.mjs、原始 TAP/JSON、包日志、安装包与包内 main；使用只读 Node/PowerShell 复算文件 SHA256、恢复记录、来源快照、native 样本和 PNG 像素。只读复核命令均 exit 0。未直接执行会覆盖 verification.json 的 finalize.mjs。

| 证据 | 原始结果与独立核对 |
| --- | --- |
| targeted-green.tap | 74 tests / 56 pass / 17 fail / 1 skipped。逐条筛选 WCO-/EMPTY-/DRAG-/WTHEME- 共 39 项全部 ok；17 个 not ok 均为 AC36 cold-source。没有将整个关联运行称为全部通过，也未把这些失败宣称为已证明的历史基线。 |
| core-full.tap/json | 245 文件，footer 与 JSON 完全一致：1731 tests / 1591 pass / 127 fail / 11 cancelled / 2 skipped，exit 1，约 17.6 分钟。未以 1701 个顶层 TAP 条目替代含子测试的最终计数。 |
| browser-full.tap/json | 28 文件，194 tests / 161 pass / 33 fail / 0 cancelled / 0 skipped，exit 1，footer 与 JSON 一致。原始输出含 fixture exports 构建错误与异步活动错误，未将载入失败导致缺失的子用例视为通过。 |
| package.log | Electron 44.6.0、win-x64、NSIS，完成 packaged 阶段；after-pack 输出 projectResources=314、pgliteClosed=true、publish=never。日志与主代理报告的包命令 exit 0 和实际产物一致；没有 NSIS 安装记录或安装通过声明。 |
| 实际 installer | 当前 `release/XaanInk-0.1.0-win-x64.exe` 为 276569956 bytes；独立 SHA256 为 `3be618f6e5b1aecfc7b45c6429975ba872201e28270566639be400d6d5811d5a`，与 verification.json 一致。 |
| 实际 main | `dist/main/index.cjs` 与 `release/win-unpacked/resources/app/dist/main/index.cjs` 独立 SHA256 均为 `7bcc8e272c592d6ea16e822e164f3ae0b525087697a29584f33f7689fc3278d3`。该结论仅覆盖 main 产物，不扩张为所有 UI/CSS 产物哈希相同。 |

## 像素与原生样本

独立查看 baseline.png、compact-normal-stable.png、Snap hover 与 100/200% 菜单 PNG。前后稳定图均为 1443×943；native JSON 外框均为 1441×942，隔离数据目录相同，前后为旧/新包两个进程实例。截图只证明该捕获尺度，不能推导所有 DPI 的同等像素结果。

对三个独立 x 区间、y=5..35 内 RGB 均 <110 的像素只读复算，与 finalize.mjs/verification.json 完全一致：

| 原生符号 | 旧 top..bottom | 新 top..bottom | x 范围（前后相同） | 暗色像素数量（前后相同） |
| --- | --- | --- | --- | --- |
| 最小化 | 22..22 | 16..16 | 1322..1331 | 10 |
| 最大化 | 18..27 | 12..21 | 1368..1376 | 33 |
| 关闭 | 18..27 | 12..21 | 1414..1423 | 23 |

三枚符号 top/bottom 均上移 6 像素，横向范围与所选阈值的像素数量相同。结合产品 diff 只改变高度，这支持位置修复及 glyph 保留；不支持“视觉线宽已统一”或“glyph 已缩小”。

独立逐个核对 verification.json 的 9 个 native JSON：normal/maximized/restored/ink/system/paper/075-workbench/200-workbench/restarted。均为实际 win32 Electron 44.6.0 package；DOM 主题、实际 zoom、captionRect、菜单和恢复入口与摘要一致。各样本菜单 y≥0、right≤captionRect.right−5，恢复入口 right≤menu.left−5；观察到的 captionUpdates 均为 height 32。初始和重启样本的更新数组为空，初始高度结论来自实际 WCO 几何，不能把空数组的 every 断言当成已观察 setter 调用。

75% 的实际 WCO height 为 43 CSS px，43×0.75=32.25 DIP；finalize 使用整数提供方舍入容差，主报告明确该量化边界，没有把读数写成精确 32。100% 与 200% 分别为 32/16 CSS px；菜单分别 top 2/0，75% top 约 7.333。200% 菜单维持 28 CSS px，其物理高度 56 DIP，只证明顶部与横向安全，未声称与原生区域等高。

独立读取 maximized/restored/minimized/unminimized 状态，布尔值依次匹配实际操作后的目标状态；主题 source 为 ink→dark、system→system、paper→light。restarted 进程 pid171200 保持 paper、zoom2、revision5，与先前 pid164132 的最终设置一致。Snap 与原生菜单截图支持弹窗可见，未验证全部 Snap 布局。

## 操作与来源边界

- `native-ui-transcript.txt` 是主代理保存的实际工具摘录：两次 Sky 原生“关闭”element_index8 点击对应 exec 会话14685/8622，后续 driver 都 exit 0、输出 closed，期间没有提交 finish/application.close 指令。该动作/退出顺序补足 native-session.mjs 自身 finally 也可关闭程序的歧义；不把脚本关闭能力当成原生 X 点击证据。
- 同一工具摘录及 `core-file-timeout.json` 记录 worker159016→suite155464→runner155520。终止前重新核对 PID、父进程和精确 handoff 测试/runner 命令，taskkill 只针对159016进程树。之后 suite 取得完整 footer，timeout/取消没有计为通过；不是终止父 suite 后伪造全量完成。
- `catalog-line-endings.json` 的 9 份 backup 和当前恢复后文件独立 hash 均匹配 before；将原文件 CRLF 规范为 LF 后均匹配 after 和既有 command catalog sourceHashes。`restored-line-endings.json` 共10文件，另含 routes.generated.ts，当前字节均与恢复记录相同，未发现语义源码修改。
- 独立复算 core 的 970 个记录来源与当前文件全部匹配；browser 970 个记录仅 routes.generated.ts 字节不同，当前 CRLF→LF hash 与 browser 快照完全相同，并与 `browser-routes-line-ending-equivalence.json` 一致。此结果不证明运行期间源码字节从未变化，主报告已注明临时等义换行规范化。
- run-suite.mjs 的来源快照只纳入 ts/tsx/json 与 package-lock，不含 desktop.css 等 CSS。三份本次改变的 TS/test 文件在两套快照均匹配当前源。CSS 的证据来自审核过的产品 diff、真实组件布局和实际窗口截图，不能将快照称为包含全部样式来源。
- native-session 在就绪等待前设置 renderer offline，使用隔离目录，脚本只启动/读取状态；原生 GUI 动作由 Sky 执行。该条件仅支持受控 unpacked 包离线启动，未证明 OS 全网断开、NSIS 已安装或完整业务已验证。

独立检查 requirements-traceability.json：DESK-W03/W04 正式 status 均仍为 planned；migration-map 的 compact 记录 fullAcceptancePassed=false，未改业务迁移映射。单机/DPI、macOS、完整拖动/吸附、全部业务与 NSIS 安装的限制均保留。有限窗控修复可以交付其真实结果；“全部通过”的总体完成结论仍不成立。
