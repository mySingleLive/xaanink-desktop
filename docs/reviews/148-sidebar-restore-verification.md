# macOS 侧栏恢复按钮修复验证

2026-10-09（Asia/Shanghai），对应本轮用户截图和 143–147 的方案、独立审核、用例及代码审核。

修复完成：仅在真实 `ChatPanel` 已有的 macOS 侧栏恢复按钮上设置左外边距；侧栏归零后按钮左缘为窗口左侧约 88px。实时缩放及 rem 字号变化均被抵消，Windows/Web 和展开态沿用原位置。无原生按钮移动、分栏重写、新 IPC 或组件替换。

| 本轮实际执行 | 结果 |
| --- | --- |
| 修改前新 browser 用例 | 9 条，6 pass / 3 fail；全部失败为安全位置几何断言，默认左缘仅6px |
| 修改后聚焦新用例及原 pane-window-drag unit/browser | 14/14 pass |
| 完整活动 unit/integration | 1624/1624 pass，0 fail/cancelled/skipped |
| 完整活动 browser | 185/185 pass，0 fail/cancelled/skipped |
| 完整 `npm run typecheck` | exit 0 |
| `npm run build:ui`、`npm run build:desktop` | 各 exit 0，当前离线 UI 与 main/service/preload 重建 |
| 本轮实际 macOS Electron 脚本 | exit 0，实际 CUA 恢复点击、重复切换、zoom/font边界、折叠态关闭重开通过；无 pageerror |

Node 24.18.0；Chromium 使用本机 `chromium_headless_shell-1228`，不宣称它等于当前 Playwright 期望的下载版本。核心及浏览器完整命令是 `node --import tsx --test --test-concurrency=2 --test-reporter=tap tests/unit/*.test.ts tests/integration/*.test.ts` 与同参数 `tests/browser/*.test.ts`；浏览器显式设置 `XAANINK_TEST_CHROMIUM`。1809 为完整活动自动测试数量，14项聚焦结果不重复加计。退役备份测试未运行。

实际 macOS 使用重建的本仓库 Electron 和完整 SidebarTree/DashboardShell/ChatPanel，协议为 `xaanink://app/`，新 canonical `/private/tmp/xaanink-sidebar-safe-*` 数据根；先验证模型与小说数均0，再在 renderer CDP offline 条件下运行，未读取默认资料或 Key。测试窗设为2200×1000以在200%仍保持宽屏布局；不授予窄屏、多屏/DPI或系统完全断网验收。

原生窗控原点由真实 `BrowserWindow.getWindowButtonPosition()` 读取，始终为 `{x:14,y:14}`；CUA AX 树仍有关闭/全屏/最小化三枚原生按钮。默认折叠时恢复按钮左缘为88px；实际 `webContents.getZoomFactor()` 的 .75/1/1.25/1.5/2与字号11/24组合，以及14默认字号测得原生逻辑左缘均约87.992–88px（实际完整范围见 JSON）。标题 drag、按钮 no-drag 保留。CUA 点击恢复按钮后侧栏恢复显示，窗口 bounds/最大化/全屏/zoom/窗控原点保持不变，未触发原生关闭；两轮 Enter 恢复与再次隐藏通过。退出保存后用同一隔离根启动新 Electron，默认外观下折叠布局保留，再次恢复通过。键盘由 Electron/CDP 注入，不声称物理硬件键盘或 IME 验收。

原生窗口截图由 CUA 获取，保留默认、75%/字号11和200%/字号24的完整 PNG 与未经补画的左上裁剪。**当前 macOS 屏幕共享指示图标替代了截图内红黄绿的可视样式，因此这些图不能逐色确认绿灯右缘或量测其可视间距。** 恢复按钮位置、原生窗控原点、AX存在和真实鼠标命中结果分别记录，不把 renderer截图或该共享指示图标称为三枚彩色窗控的视觉证据。143预期约20px间距依据既有窗控布局，当前截图未重新量测该颜色边界。

环境/夹具失败保留并未计为通过：首次 sandbox 内 Chromium启动停滞，停止本任务确切进程后在获准的正常进程权限下取得功能 RED；初次 browser 6条因 `tests/generated` 尚未存在失败，初次 typecheck 因adapter Client缺失失败，执行 `npm run generate:test` 后完整 browser/typecheck 重跑通过。完整 core在adapter用例开始前生成完成，最终1624项均通过。首次 native 使用 OS tmpdir 的 `/var` 祖先，产品根权限校验返回 `ROOT_STARTUP_FAILED`；保留失败 JSON/日志，只将测试夹具改为 canonical `/private/tmp` 后通过，未改生产根目录校验。

全部日志副本、native JSON/截图、源码与当前 out/dist SHA-256 指纹见 `docs/evidence/implementation-46/`。`verification.json` 绑定测试数量、native左缘范围与实际编译产物，`native-initial-harness-failure.json` 保存首次真实失败。原始日志仍位于 `/private/tmp/xaanink-sidebar-safe-*.log`。本轮没有重新打包、安装、发布或 Windows 目标机运行；旧 release 不含此次修复。W05只新增本次有限 development记录，整项正式status及业务迁移状态保持原值。
