# Windows 顶部对齐及关闭加粗最终证据独立审核

日期：2026-10-10（Asia/Shanghai）。依据最终验证报告、原始完整 TAP/JSON、finalize 与运行脚本、原生采样/原图/driver、源码恢复记录、实际安装器和包内 main、两份台账独立只读核对。仅新增本审核文件；没有修改产品、测试、夹具、主验证报告或台账，没有追加测试、构建或原生操作。

结论：**本轮有限验收通过，无发现的剩余阻断项；完整 core/browser 及正式验收未通过。** 通过范围是本机固定 Electron 44.6.0、Windows OS scale 1.5 下的三栏顶部对齐、关闭 X 加粗及报告明确覆盖的生命周期操作。未执行项目和全量失败保持原状态。

## 完整运行与专项结果

| 最新完整运行 | tests | pass | fail | cancelled | skipped | exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| core，246 文件 | 1741 | 1601 | 125 | 13 | 2 | 1 |
| browser，29 文件 | 212 | 184 | 28 | 0 | 0 | 1 |

两份原始 TAP 最终 footer 与各自 JSON、verification.json、主报告和台账逐项一致。core 时长 1201747.1072 ms，browser 372543.764 ms；Node v24.19.0，browser metadata 明确记录既有 `C:/Program Files/Google/Chrome/Application/chrome.exe`。漏浏览器路径的 207 hook 环境失败另存，不当作最终产品运行。修正前完整 core 1739/1608 pass/123 fail/6 cancelled/2 skipped、browser 212/187 pass/25 fail 保留为历史，新增失败未被称为已证实基线或与改动无关。

审核者独立从最新完整 core/browser 解析每条实际结果，并对 verification.json 的 52 个专项名称逐项查找：**52 个唯一名称，每项恰好一个结果，全部 pass**。不拼接旧版本结果，不把矩阵场景重复计为顶层 test。对应 finalizer 以 targeted-green 的 49 个名称加最终 CLOSE-06/07/08 选名，再从完整结果提取；其机制正确。此前本审核者已独立运行最新 CLOSE 单测 10/10、exit 0，见 geometry-code-review，本次未重复执行。

core-run.json 的 runner/test runner 为 219656/211536；core-file-timeout-geometry.json 记录直属 worker 222464→211536→219656、392.1582935 秒与指定 work-lease-handoff 文件。原始 TAP 包含至 LH23-22 的实际结果，该项为 HANDOFF_IO_FAILED；完整失败、取消和超时均保留。现场 PID/创建时间、无子进程确认和仅终止该 worker 属主代理当时工具操作记录，本审核没有重放终止。进程清理不计 pass，未以未闭合输出估算最终 footer。

## 来源、恢复与包

独立读取两套完整运行的 **977 个 TS/TSX/JSON/CSS 与 lockfile 来源 hash**。当前 10 个产品文件与 core/browser 均逐字节一致，包含 native-close-accent、三窗口入口、window-appearance、DesktopApp、WindowControls、ChatPanel、ContentTabs、desktop.css。977 个 core 来源中仅 10 个当前 raw hash 不同，完全等于恢复记录的 9 个 catalog 源与 generated routes；每个当前内容归一 LF 后精确等于 core 与 browser 来源，无其它来源变化。九个原始备份的 before hash、当前 raw hash 与归一 LF after hash亦逐项一致；routes 按原 compact 来源 hash 校验后恢复。没有把换行等价称为全部 raw 字节相同。

审核独立计算实际文件：安装器 `release/XaanInk-0.1.0-win-x64.exe` **276571859 bytes**，SHA256 **5c17d54b6bbd84f5d9878314c1132f358fac407c95cd919eb02dbadc3c0d2270**；`dist/main/index.cjs` 与包内 `resources/app/dist/main/index.cjs` 的 SHA256 均 **8935653ae32a3760dc616cbe127b16cd913a443d5c5c485804086fc71d5bd400**。accent 源为 **4c2620e63e5c213c0b9431bdcaebdd073db2ba7bbe560f2c79682a8b8afc9b23**，与完整运行及最新原生样本一致。

package-geometry.log 实际包含 after-pack 验证 314 项目资源、pgliteClosed=true、publish=never 及 packaged 结束。类型检查、UI/desktop 构建、package session exit 0 和 finalize exit 0 依据主代理实际命令/会话结果；审核读取相关日志、finalizer 检查与最终输出，未再构建。finalizer 中固定的 exitCode 字段不能独自证明命令执行，本审核没有将它当作唯一依据。安装器已生成，实际 unpacked exe 已运行；未执行 NSIS 安装或升级。

## 原生与视觉证据

最终 verification.json 仅收取 main SHA 匹配当前 main 的 **10 个 geometry 样本**。独立核对 normal/max/restore/min/fullscreen/恢复/hover/final：一个 BrowserWindow、两个 BaseWindow，装饰只有一个 ImageView；normal 实际装饰约 47×38 DIP、view 46×31，max 为 46×38、view 46×32。可验布局时 15 个可见 button/SVG 中心均为 16 或 16.1666669846 DIP，三条标题高 32 DIP。Chat 空态没有显示的标题按钮不冒充已在该原生状态出现；更广的空/单/多 Tab、五 zoom×三字号覆盖仍属真实组件受控 browser 测试。

审核者查看原图，且只读解码 product-glyph-observations.json 的五张原 JPEG，逐项验证原图 SHA、尺寸、阈值 120 暗像素与 bbox：normal/restored/min-restored/final 均 `[1414,12,1423,21]`、49；max `[2532,10,2541,19]`、49，全部与观察记录一致。原生干净 normal/max 基准和机械开/关对照支持位置贴合与覆盖加粗，前次额外上下尾行已消除。没有裁剪、改图或重采样生成证据，没有宣称 JPEG 阈值等于精确物理线宽或 Codex 像素规格。hover 图指针遮挡部分 X，仅支持原生红背景与可见白色，不用于完整 hover glyph 像素结论。

minimized/fullscreen 样本装饰隐藏，恢复可见；min/min-restored 两次记录 cursor=(1886,240)，处于关闭区外，恢复原 bounds。该记录支持两次采样的相同位置，不单凭 JSON 宣称整个操作过程中鼠标从未移动。geometry-moved 的 bounds 未改变，主报告明确不计真实拖动通过。

native-geometry-session ready 的 main/source SHA 与本轮包一致，最终 closed 明确 applicationExitCode=0；主代理 Sky 原生 X 点击和 exec session 73486 exit 0 的实际操作记录相互支持正常退出。driver 的 finally 存在程序性 close 后备，故本审核没有仅据 stage=closed 推定鼠标点击成功。所有 UI 输入由主代理 Sky 完成，审核没有模拟点击或重演输入。CDP renderer offline 亦未被扩大为系统全网断开。

修正前包的主题/75与200% zoom、原生目录 dialog enabled/modal、Snap popup、关闭后 staged/recovery 草稿重启可查看已明确单列为较早版本结果。未把较早小 host 原图当最终单 X 证据，也未将该轮草稿保留称为最新包直接正文 DB 提交或完整关闭失败/取消矩阵。原生 Snap 和保存路径代码仍保留；本次有限结果不是这些所有分支的新包复验。

## 台账与限制

requirements-traceability.json 的 W03、W04 正式 status 均仍 planned；W03 只追加 captionAlignmentAndCloseWeight 的限定记录。migration-map.json 顶层和 29 个业务 Tab 状态仍 planned，仅新增 caption alignment 开发记录；两处均保留完整失败/取消、fullAcceptancePassed=false 与本轮实际证据。未把启动或专项成功提升为全部业务/双平台通过。

固定 Electron、setShape 实验性 API、单真实 DPI、真实字号仅 14、无多屏/跨 DPI/RTL、未完整执行跨应用遮挡/焦点/pressed/快速 hover 逐帧、整个钳制区点击、真正拖动与全部 Snap 布局、maintenance/relocation 实际 OS 窗体、完整关闭错误/取消及安装/升级矩阵，均保持明确限制。完整测试失败仍是未完成的正式验收条件；本报告仅通过当前限定修复及其证据一致性。
