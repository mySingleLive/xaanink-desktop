# 空右侧内容面板收起按钮验证

2026-10-09（Asia/Shanghai）。本轮用户要求及150–154方案、用例、独立审核对应的有限修复已实现。

真实 `ContentTabs.tsx` 的零Tab拖动条现包含顶部右侧的PanelRight图标按钮，名称/提示为“隐藏内容面板”，点击调用原 `DashboardShell` 收起回调。保留原有动画、AI标题恢复入口、最后Tab关闭时自动收起、空态正文和有Tab导轨。父级不再aria-hidden；原生button可Tab到达，Enter/Space激活并显示焦点边框；拖动空白和按钮no-drag保持。

Windows空工具条右距取原生titlebar env占区与138/实时zoom的保守值之大者，再留40px给既有应用菜单及6px间隔。macOS/Web默认右距8px（随rem字号变化）。仅一处产品组件修改，无新IPC、HTTP服务、模拟作品或原生窗控变更。

| 实际执行 | 最终结果 |
| --- | --- |
| 修改前最终RED | 新8例均因可访问按钮数量0而失败，无运行环境失败 |
| 修改后聚焦按钮/窗口拖动/侧栏安全回归 | 22/22 pass |
| 完整活动unit/integration | 1624/1624 pass，0 fail/cancelled/skipped |
| 完整活动browser | 193/193 pass，0 fail/cancelled/skipped |
| 完整npm run typecheck | exit 0 |
| npm run build:ui、npm run build:desktop | 各exit 0，离线UI/main/service/preload重建 |
| 完整真实macOS Electron harness | exit 0，22条检查，errors=[] |

1817是两个完整自动测试套件相加，聚焦22及native检查不重复计入。Node 24.18.0；Chromium使用现存headless-shell-1228，不声明它等于当前Playwright下载版本。完整命令是 `node --import tsx --test --test-concurrency=2 --test-reporter=tap tests/unit/*.test.ts tests/integration/*.test.ts` 和同参数 `tests/browser/*.test.ts`；浏览器明确设置XAANINK_TEST_CHROMIUM。退役备份测试未运行。

Windows浏览器矩阵检查真实组件按钮/菜单几何：fallback45组（280/320/440px面板×5个zoom×3个字号），env读取注入48组（320/440px×3个zoom×2个字号×4个占区）。全部按钮可见且位于面板顶行内部，右边界在窗控预期占区及菜单左侧，菜单间隔至少6px。fallback使用未经替换的生产表达式；env注入仅替换当前真实inline style及真实菜单CSS中的env读取，保留其它计算。**这是浏览器布局合同，不是Windows/DPI原生验收。**

真实macOS使用当前源构建、本地xaanink://app/协议、CDP offline、新canonical /private/tmp隔离dataRoot。先断言小说/模型均零。CUA按本轮独立运行时bundle路径选择实际空数据窗口，截图可见顶右图标；实际系统鼠标点击后原生harness确认.workspace-content卸载、AI恢复按钮可见，窗口bounds/zoom/最大化/全屏不变。Enter/Space检查真实Shift+Tab/Tab、焦点outline和收起；keyboard由Electron/CDP注入，不声称硬件键盘/IME。真实zoom .75/1/1.25/1.5/2×字号11/24的十组实时设置与原生zoom读数全部通过，工具条drag/按钮no-drag保持。

关闭重开沿用既有 `draft-recovery.ts:218–220` 的零Tab恢复规则：contentVisible布局进入待核对项，工作台先收起空区；随后实际AI恢复入口重新打开空面板并收起成功。没有修改该规则。用既有seed helper在同一隔离根建立真实合成小说，点击真实章节树打开Tab，关闭最后Tab仍自动收起；AI恢复后空工具条按钮再次可用。连续8帧实际面板width/x稳定才检查几何或截图，避免把展开动画中途算作完成。

正常数据与Key未用于本轮测试。初次CUA按本仓库bundle路径选择存在同路径多进程歧义，未对旧窗口点击或保存截图，不计通过；仅结束本轮确切测试进程，旧进程未动。harness改用已安装官方Electron.app的临时独立副本，明确executablePath，不修改原安装运行时，成功后清理隔离根。

失败及修正保留：初次typecheck因测试menuRule可能undefined失败，拆assert明确收窄后通过；初次browser与UI构建同时进行，四组旧用例读.next/static/chunks遇ENOENT，记录167 pass/4 file failures；此调度失误已修正为构建完成后全量browser重跑193项。初次完整native错误地期望零Tab可见状态自动恢复，在上述既有恢复规则处超时；失败JSON/日志及其原生截图已另存，修改测试夹具后完整流程重跑通过，未放宽产品断言或修改恢复实现。最终复查又发现首次路径歧义gate的Node宿主在收到终止信号后仍等待，10分钟后超时finally覆盖了共享结果文件；保存该真实失败记录，确认旧harness已退出，并将每次运行的全部图片/JSON改为独立子目录，仅passed后更新最终alias，再完整重跑。没有从记忆重建成功报告。最终通过均指最终完整日志及稳定的独立原生报告，不删除失败结果充当通过。

日志副本、native JSON、CUA原生截图、带renderer后缀的DOM截图和当前源码/测试/构建SHA-256见 `docs/evidence/implementation-47/verification.json`。CUA原生截图与renderer截图分开，不把后者当原生窗控证据。该轮窗口2200×1000，保持200%下宽屏布局；不声明窄屏全工作台、多屏、Windows、系统完全断网或安装包验收完成。未重新打包、安装或发布，既有release不含本轮修复。W05及业务迁移总状态保留，只新增此次development记录。
