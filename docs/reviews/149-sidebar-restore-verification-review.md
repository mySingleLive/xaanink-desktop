# macOS 侧栏恢复按钮最终证据独立复查

2026-10-09（Asia/Shanghai）。独立复查 `148-sidebar-restore-verification.md`、`docs/evidence/implementation-46/` 的实际日志/JSON/截图，以及 W05 与迁移台账精确 diff。仅写本报告，不重新运行测试、启动 UI 或修改实现。

结论：**同意本次有限 macOS development 修复及验证记录，无阻塞代码或证据一致性问题。** 自动测试和真实恢复操作证据成立；三枚彩色原生按钮的绿灯右缘/精确可视间距仍未量测，不据此授予完整 W05、Windows、窄屏或当前安装包正式验收。

## 命令与计数

逐一读最终 core/browser/green 日志尾部及 typecheck、UI/desktop build 输出：core 为 1624 pass、0 fail/cancelled/skipped；browser 为 185 pass、0 fail/cancelled/skipped；聚焦 GREEN 为 14 pass、0 fail/cancelled/skipped。1809 是两个完整活动套件相加，14 项未重复计入。此前 147 核对的 RED 仍为 9 项中 3 个实际几何失败，并未用运行环境失败冒充 RED。

完整 typecheck 输出是 `tsc --noEmit`；UI 输出完成 production compilation、TypeScript 和静态页面生成；desktop 输出执行本仓库构建脚本。主代理已记录对应退出码 0，最终输出未发现错误。此次独立运行 `git diff --check` 返回 exit 0。浏览器显式使用本机 headless shell 的限制被 148 保留，没有声称匹配当前 Playwright 下载版本。

## 指纹与真实 macOS 运行

用只读 Node SHA-256 校验命令逐个重算 `verification.json.fingerprints` 的 **243 个**当前源码、测试、harness、out 与 dist 文件，全部匹配，0 mismatch。`sidebar-restore-native.json.sourceHashes` 的 ChatPanel/main/DesktopApp 三项也分别匹配当前文件。三份具名 native CUA gate 完整 PNG 的 SHA-256 均与 native report 匹配；没有用 renderer PNG 替代 native gate 的文件。

读取实际最终 native JSON：`status=passed`、20 checks、`errors=[]`；native 日志包含默认/最小/最大三次 CUA gate 及最终通过输出。所有几何采样均是 sidebarWidth=0、标题 drag、按钮 no-drag，原生按钮原点均为 `(14,14)`。实际 window content width 为 2200，最大真实 zoom=2，因此各点 CSS 视口都仍≥900，未用窄屏帧替代宽屏验收。

实际 zoom .75/1/1.25/1.5/2 × 字号11/24的十项矩阵完整，root font 分别为12.5714px/27.4286px；默认字号14也有88px结果。由所有 nativeLeft 记录重新计算的范围 **87.9921875–88px** 与 verification JSON 完全相符。默认 CUA 恢复 gate 后的真实 sidebar 展开、恢复按钮消失与原生窗口对象保持一致由 harness 实际断言；重复 Enter 恢复及默认外观关闭重开由后续流程断言。重开后报告记录 sidebarWidth=0、zoom=1、rootFont=16px、nativeLeft=88px，符合已声明范围。

已独立查看 default/controls-visible/minimum/maximum 左上截图，画面确为当前 macOS 屏幕共享指示图标及右侧恢复图标；它们无法提供三枚红黄绿的逐色边界。148、verification JSON 和两处台账均明确保留此限制，没有将 AX 控件存在或按钮原点 `(14,14)` 误写为绿灯右缘量测。88px 是本次实际恢复按钮位置；“约20px”继续只属于根据既有标准窗控布局的预期，不能当作本次已量测的可视间距。

## 环境修正与台账范围

首次 native `ROOT_STARTUP_FAILED` 的完整失败 JSON/日志仍保留，未被列入通过计数；脚本后续只将自建测试目录从 macOS `/var` 祖先换为 canonical `/private/tmp`，没有放宽生产根目录权限校验。初次 browser/typecheck 缺测试 adapter Client 的失败也保留，`generate-test.log` 显示按已有 schema 生成后完整重跑。最终证据不是把失败文件删掉后只写通过结论。

当前产品精确 diff 仍仅 ChatPanel 恢复按钮 margin/comment；辅助改动是标题提取测试夹具、新 SAFE browser 用例和 native harness。`requirements-traceability.json` 的 W05 顶层仍 `status=planned`、正式 `evidence=[]`，只新增有限 development；`migration-map.json` 只增同名修复记录，其余业务迁移状态未变。148 与台账清楚声明未重新打包、安装、发布、Windows、窄屏、多屏/DPI、硬件键盘/IME或系统完全断网验证。该范围与本次源改动、执行内容及现有实施边界一致。
