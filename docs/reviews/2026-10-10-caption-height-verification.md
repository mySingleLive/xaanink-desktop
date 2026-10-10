# 三栏顶部高度恢复验证记录

本轮用户修改已实现：Windows 左导航、AI 对话区、右内容面板顶部统一恢复 44 DIP；增加的 12 DIP 留在原 32 DIP 控件区下方，所有顶部按钮位置、尺寸保持不变。原生窗控和关闭 X 不变。有限验证通过，整体验收未通过。

## 实现与专项

产品改动仅 `src/app/desktop.css` 中 Windows 标题规则的高度、下内边距和解释注释。SidebarWindowControls、ChatPanel、ContentTabs 仍使用原真实组件；现有菜单、安全区、Tab、原生关闭和业务流程没有本轮源改动。方案、测试清单及代码的独立审核见同日前缀 caption-height 的 plan-review、test-review、code-review。

修改前实际 RED 为 5 项 / 4 pass / 1 fail / exit 1：首个 zoom .75 场景测得标题约 32 DIP，44 DIP 断言失败，控件固定几何先通过。首次 Chrome 启动退出的 5 个 hook 失败另存 `tdd-red-browser-launch-failure.tap`，不计行为 RED。实现后同命令 5/5、exit 0。ALIGN-01/HEIGHT-01 覆盖 5 zoom × 3 字号 × 空/单/八 Tab 共 45 场景：三栏同高 44、正文从 44 开始、Tab 仍 32、无额外纵向滚动；按钮/SVG 的 top/width/height/centre 独立固定预期均通过。窄布局、原 handlers、Web/mac 默认样式检查保留。业务正文/AI effects 仍为受控夹具，平台样式切换不计 mac 原生验收。

从本轮最新完整 core/browser 结果逐项提取关联名称，52 个名称各有唯一实际结果，全部 pass；只沿用上一轮的选名并替换本轮 ALIGN-01 名称，不拼接旧结果。见 `docs/evidence/caption-height/verification.json` 与 `finalize.mjs`。

## 完整运行

| 本轮完整运行 | 文件 | tests | pass | fail | cancelled | skipped | exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| core | 246 | 1741 | 1605 | 123 | 11 | 2 | 1 |
| browser | 29 | 206 | 174 | 32 | 0 | 0 | 1 |

core 时长 921793.8758 ms，browser 405558.0731 ms。Node 24.19.0；browser 明确使用本机 Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe`，当前文件版本目录 154.0.8037.98。全部活动测试文件纳入运行，部分文件及用例失败/超时/取消；footer 的实际数量不等于每个预定业务场景都已通过或全部完成。原始 TAP 与 JSON 留在本轮 evidence 目录。失败涉及迁移/租约、剪贴板、导出、维修/重定位与部分受控模块缺失导出等；不将本轮失败称为已证实基线或与改动无关。

work-lease-handoff 已输出全部 22 个结果，包括 LH23-20 实际 120 秒超时及 LH23-22 HANDOFF_IO_FAILED，但其 worker 仍未退出。只在实际 CIM 核对 worker 258536 → test runner 269712 → 本轮 runner 270648、精确创建时间、age 367.1396618 秒、无子进程及完整 22 结果后停止该 worker；没有停止其它进程。清理只用于结束本轮失败运行，不计 pass。记录见 `core-file-timeout.json`；完整 footer 在清理后实际取得，session 98403 exit 1。

## 构建、来源及包

类型检查（session 58025）、UI 构建（74694）、desktop 构建、打包（58959）均实际 exit 0；after-pack 验证 314 资源、PGlite 已关闭。命令日志及会话编号汇总于 `checks.json`，静态 JSON 中的 exit 字段不能单独代替真实执行记录。

最终安装器 `release/XaanInk-0.1.0-win-x64.exe`：276571803 bytes，SHA256 `c01a495d7f98e14a8211b79a143b71289b43cbb99cbb65307ae57d7731344d29`。dist/main 与包内 main 均为 `8935653ae32a3760dc616cbe127b16cd913a443d5c5c485804086fc71d5bd400`，与上一轮相同；CSS 源为 `2abb25ebe1b07dc521b351ad951ea51431c2906a74fb1d27eb98a26053a51a43`。已运行 unpacked exe，未执行 NSIS 安装/升级。

两个完整运行的源快照一致，977 个来源相对上轮最新完整运行仅 CSS 与 caption-alignment 测试两个文件 hash 改变。本轮构建/测试沿用既有 catalog 的 LF 字节，9 个 catalog 源临时只归一换行，routes 由既有生成器输出 LF；结束后 10 个文件均恢复精确原始字节，归一 LF 后仍逐字节匹配两套运行快照，其它源无运行后变化。11 个产品/关联测试源当前 raw hash 均与两套完整运行一致。prepare/restore 脚本与恢复记录保留，没有遗失其它人的修改或把换行等价称为 raw 全树相同。

## 真实 Windows

Electron 44.6.0，实际 OS scale 1.5，应用 zoom 1、UI 字号 14、paper。新包复用上一轮隔离测试目录 R2naSg，不读取作者目录。renderer 通过 CDP offline，不代表系统全网断开；只读采样与 pass-through overlay setter 记录用于取证，全部 UI 输入使用 Sky。

原生 normal / max / restored 三组，三个标题均为 44 DIP，overlay 仍 32 DIP。与同一隔离夹具的旧 geometry-final / max 比较，15 个可见按钮/SVG 的 labels、x、y、width、height 完全相同（实际最大差 0），中心为 16 或 16.1667 DIP；main 和关闭 X 源 hash 相同。比较脚本与逐项记录见 `compare-native.mjs` / `native-comparison.json`。当前空对话头部确实没有可见按钮，不将不存在的按钮计入原生 15 项；其显隐按钮与其它状态由上述真实 header browser 场景覆盖。

Sky 实际点击原生最大化、还原与 X。X 点击后应用正常退出（applicationExitCode 0、driver session 3675 exit 0），后续 Sky 包窗口库存为空。driver finally 有 fallback close，因此此结论结合实际 Sky 点击和执行结果，非仅凭 closed 日志推定。三个截图 `height-normal.jpg` / `height-max.jpg` / `height-restored.jpg` 均是原始捕获，没有裁剪、重采样或改图；最大化图右下无关系统广告未操作。

本轮未新增真实多屏、其它物理 DPI/mac、不同字体/应用 zoom、完整拖动/Snap、关闭保存错误/取消或安装/升级矩阵。前轮关闭装饰的固定 Electron / setShape 等限制沿用，旧轮结果不冒充本轮复验。W03/W04 与业务正式验收保持 planned，`fullAcceptancePassed=false`。
