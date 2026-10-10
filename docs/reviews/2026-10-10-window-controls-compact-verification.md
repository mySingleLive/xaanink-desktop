# Windows 紧凑窗控验证

日期：2026-10-10。产品修改仅 `desktop/main/window-appearance.ts` 的原生高度 44→32 DIP 和 `src/app/desktop.css` 的 Windows 菜单顶部；原 Web 顶栏、三栏组件与 macOS 窗控未改。

## 原因与实际效果

三枚图标由 Electron 原生 WinCaptionButton/Chromium WindowsIconPainter 绘制。横线、圆角矩形及抗锯齿斜线的像素覆盖不同，产生视觉粗细差异；公开 overlay API 没有分别修改线宽/图标大小的接口。保留已批准的原生窗控，不声称线宽已统一或 glyph 已缩小。依据见本轮方案的上游源码与公开接口链接。

旧/新包分别启动两个进程实例，使用同一隔离数据目录、相同外框 1441×942 和100% 缩放；旧包 overlay 为44，新包为32。两张原始窗口截图均为1443×943，与主进程外框是不同测量量。原始截图 `baseline.png` 与稳定的 `compact-normal-stable.png` 对照：最小化、最大化、关闭图标的暗色像素顶部均上移 **6个截图像素**，符号横向范围保持。菜单 CSS top 从7到2，28×28 CSS px 保持，中心为16。截图由 Computer Use/Sky 获取；像素范围由 `finalize.mjs` 分析原始 PNG，未改图。不是对 Codex 的逐像素测量或所有 DPI 的承诺。

## 阶段与回归

技术方案、测试清单、code review 均依次独立审核通过，见本轮 plan-review/test-review/code-review。

- 实质 TDD RED：旧 helper/三种真实构造为44而期望32，unit 12项中5项失败；实际菜单 WCO-C03 在旧top7下失败。沙箱spawn EPERM及默认Playwright浏览器缺失属于环境失败，不计产品红灯；最终使用本机Chrome。保留原 WTHEME/WCO-S 的行为断言。
- 关联运行 `targeted-green.tap`：74项、56通过、17失败、1跳过。其中窗控/安全区/拖动的 **39项全部通过**；17项失败均在此次额外运行的 application-cold-source 套件。不将整个74项称为GREEN通过，也没有证明这些失败是历史基线。
- 最终全量core：1731项、1591通过、127失败、11取消、2跳过，exit1，约17.6分钟。含目录/审计持久化、导出、handoff等失败。`work-lease-handoff.test.ts` 的120秒超时未排空IO；核对worker159016→suite155464→本轮runner155520后，仅结束该worker进程树并记录 `core-file-timeout.json`。取消不算通过，其余文件继续得到最终footer。
- 最终全量browser：28文件、194项、161通过、33失败、无取消/跳过，exit1。失败含剪贴板、导出和受控fixture缺少exports；载入失败导致计数减少不能算未运行子用例通过。窗控相关用例均通过。来源哈希及命令在 `core-full.json`/`browser-full.json`；runner 的哈希筛选只覆盖 ts/json，不包含 `desktop.css`，不将其称为整个源码树的完整快照。
- Node24.19.0 `tsc --noEmit` exit0；最终完整生产构建exit0。首次desktop build因快捷键源文件CRLF与已有LF哈希不一致失败；9文件仅在规范为LF后严格等于既有catalog哈希时转换，再完整构建。最终恢复这些原始字节；没有快捷键源码内容修改。构建生成的routes仅恢复与运行前哈希严格匹配的换行，见 `catalog-line-endings.json`/`restored-line-endings.json`。核心/浏览器运行期间存在这次等义换行规范化，来源记录不得误称整个运行期间字节完全不变。

最终恢复后，core 快照的970个文件哈希与当前文件全部匹配；browser 快照仅 `desktop/service/routes.generated.ts` 字节不同，其 LF 规范化哈希与 browser 快照相同，见 `browser-routes-line-ending-equivalence.json`。实际原生关闭及超时 worker 父链的已执行工具摘录见 `native-ui-transcript.txt`，不从 driver 的关闭后备代码推断真实点击。

## 最终包与真实 Windows

`package.log` exit0，Electron44.6.0 win-x64 NSIS，314项资源检查通过，包内PGlite正常关闭。无发布、签名或NSIS安装。

- `release/XaanInk-0.1.0-win-x64.exe`：276569956 bytes。
- SHA256：`3be618f6e5b1aecfc7b45c6429975ba872201e28270566639be400d6d5811d5a`。
- 构建main与包内main哈希一致，完整哈希在 `verification.json`。

隔离夹具无作者作品/Key，GUI操作仅针对本轮win-unpacked窗口；另一作者开发窗口未操作。Playwright仅启动、在就绪等待前设置renderer offline及读取主进程/DOM；真实点击/键盘/悬停由Computer Use执行。此条件证明受控包离线启动，不是OS全网断开或NSIS安装验证。

1. 点击最大化按钮顶部y4实际 `isMaximized=true`；点击原生恢复后false，外框回到原值。两种状态overlay均32。
2. 原生最大化hover灰底与Windows Snap弹窗可见，未执行全部Snap布局。原生最小化后实际 `isMinimized=true`；Sky激活后false。最小化窗口不能截图，工具两次读取错误保留，不作为截图成功；实际主进程状态单列。
3. 应用菜单在100%和200%通过真实点击打开；菜单弹窗有独立工具截图。主题通过实际设置UI执行paper→ink→system→paper，原生source及symbol与实际主题同步，所有观察到的setTitleBarOverlay height均32。部分动作后立即截图仍为保存/动画过渡，JSON由后续稳定主进程读取；这些PNG不能称为已稳定目标主题截图。
4. 原生100/75/200%几何分别height32/43/16 CSS px；75%的WCO API取整数，43×.75=32.25，属提供方舍入，不能声称API读取精确32。75% menu top7.333，200% top0；28 CSS px菜单在200%物理高56 DIP，保留顶部安全但不与32 DIP窗控等高。三个缩放的菜单、实际恢复内容入口与caption无交集。9个稳定JSON样本经 `finalize.mjs`核对；本轮真实窗口为空工作台，不冒称已复验全部有Tab/窄窗组合，相关完整组件矩阵在browser单列。
5. 点击原生关闭，driver正常exit0；重新启动时paper/zoom2/revision5保留，height16 CSS px对应32 DIP。再次正常关闭exit0。窗口截图最大化过渡中包含其他应用边缘/弹窗，未操作这些应用，截图只支持窗控范围，不作业务内容验收。

全量未全部通过，多屏/DPI、完整拖动/吸附、macOS、NSIS安装及全部业务未验证。DESK-W03/W04正式状态保持planned。本次有限窗控位置修复已实施并有真实Windows证据。

最终独立证据审核通过有限修复、未通过全量验收，见 `2026-10-10-window-controls-compact-verification-review.md`。
