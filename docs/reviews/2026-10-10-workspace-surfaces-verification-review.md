# 工作区外观执行证据独立审核

2026-10-10。独立子代理只读审核当前源码、构建资源、测试报告及实际 Windows 截图，仅新增及补充本文件。结论：**本次有限 UI 专项与真实 Windows 工作台检查的证据审核通过；完整验收未通过，不能输出全部测试通过后的完成总结。** 已补审最终 bounded core 日志、runner 汇总及单 worker 人工终止记录，所有失败、取消与跳过保留。

## 当前源码与实际加载资源

- `native-local-07/windows-electron.json` 的8个源码 SHA-256 全部与当前文件一致；四个产品文件亦与独立 code review 指纹相同。核对包括全局 CSS、verify/seed 脚本及 lockfile，未用旧设计预览代替产品代码。bounded core 结束后重新核对全部8个源码、177个 bundle 及173个 out 静态资源，仍全部匹配；core 中重新生成构建的字节没有使原生证据失效。
- 原生报告记录的177个 `dist` 与 `.next/static` JS/CSS/CJS 指纹均与当前文件一致。独立补查实际协议加载的 `out/_next/static`：173个资源全部与对应 `.next/static` 文件逐字节一致，包含报告筛选范围外的字体；`out/index.html` 与 `.next/server/app/index.html` 一致，SHA-256 为 `0a8ea9d113daf82cc7b19d19f8592c558472d275a61a65077a4fd4efc3e8e34d`。
- `desktop/main/index.ts:258,264,704` 的正式协议从当前应用目录 `out` 加载 `xaanink://app/`，拒绝 HTTP/HTTPS 请求；`next.config.mjs:2` 为静态 export。因此本次实际界面与已核对构建资源绑定，而非仅凭 `.next` 名称推断。启动的是当前仓库构建与本机 Electron，**没有新安装包验证结论**。
- native 最终报告 SHA-256：`70457fb4af0be1983ed608c905392a106a612bb5501dd9fdc953912c690d1c1f`。全部六张截图的实际文件哈希与报告记录一致。

## Windows 有限检查

最终原生运行 `native-local-07`：2026-10-10T08:10:14.113Z 至 08:12:12.041Z，win32、Electron44.6.0、Node24.21.0，status passed，39个检查点、0 pageerrors。39包含13个完整几何记录、6个截图记录及20个其他检查，不等于39个独立测试用例，也不代表29类业务迁移验收完成。

`verify-workspace-surfaces.mjs:10,20,24–27` 新建 temp 隔离根，设置 `XAANINK_TEST_ROOT`，令 renderer 离线，断言正式协议、实际数据根及模型数0；这些是与执行版本哈希绑定的脚本断言，报告未另存 bootstrap 快照，不伪称存在独立隔离字段。真实 Workspaces/Prisma/DraftJournal 仅在新测试根创建合成数据，之后操作真实面板和 settings IPC。脚本未注入设计 CSS、替换产品 DOM 或启用模型调用。

核对固定期望与记录：导航 `rgb(245,238,220)`、AI `rgb(250,246,232)`、内容 `rgb(248,243,228)`，结构线 `rgb(216,203,166)`；正文/gutter/preview、规划、试验场、实际 `.scene-workspace` 和候选稿分别检查。AI 原内嵌编辑器仍为 `rgb(249,244,228)`，任务表面为 `rgb(252,248,238)`。这证明已执行面板的颜色接入，不扩展为未打开业务界面均已验收。

13组几何记录中横线与竖分栏的实际边框宽度相等，最大宽度差为0；面板与分栏相邻边缘误差最多约0.0000611 CSSpx。零内容宽、透明背景、无子线，记录及截图均支持去除额外宽亮槽。基线 DPR1.5，原生 zoom .75/1/1.25/1.5/2、字号11/24共10组及字号14基线；实际 DPR 随 zoom 为1.125/1.5/1.875/2.25/3，实际边框宽度随取整变化。不得将作者声明1 CSSpx误记为每种 zoom 下恒定1设备像素。44 DIP头部、按钮中心/尺寸、图标及 caption/menu 安全区检查保留，控制中心最大偏差约0.292 DIP。

真实 Markdown edit/preview 中线、Markdown hr 与稿件菜单分隔的实际厚度核对通过；分屏两列有内容、边缘直接邻接。实际 Group 的线旁约3px位置鼠标拖拽与键盘改变尺寸，支持保留库的不可见扩展命中区。全屏 chat 残宽为0.46875 CSSpx，乘运行时 DPR1.5 为0.703125设备px，满足经审核的≤1设备px容差；同时断言全屏 ARIA pressed 与0条分隔，导航隐藏时另校验1条剩余分隔及重新显示入口。未改产品折叠逻辑，也不声称精确零宽或已证明修改前同场景结果。

正文 paper→ink→paper 后仍为同一 Monaco DOM；主题切换前后稿件哈希相同，真实选中末行在切换后仍可替换，两次 undo 还原原稿。CDP `imeSetComposition/insertText` 的组合输入链及 undo 检查通过，范围明确为**合成 Chromium 输入，不是物理 Windows 输入法或 macOS 验证**。真实设置显隐、全屏、窄窗入口、持久化和关闭重开分别执行。

独立查看最终六张 PNG：空态、规划、试验场、场景、候选稿、正文分屏，均与真实组件结构和数据前置相符，宣纸色差与细线符合批准 v3。六张均为三栏态且正常显示 AI 内容，不充当最终全屏截图；全屏显隐结论以上述真实几何与 ARIA 为依据。

## 专项、构建与完整回归

逐一核对已完成 JSON 与原始日志哈希：

| 证据 | 可成立的结果 |
| --- | --- |
| `green-scene-final` | 12 tests / 12 pass / 0 fail、cancelled、skipped；7项工作区专项与5项既有 caption 回归 |
| `typecheck-all-final`、`foundation-final` | exit0 |
| `build-ui-corrected`、`desktop-catalog-corrected` | exit0，当前 UI/桌面构建 |
| `browser-fixtures-corrected` | 3个既有平台夹具的原用例24/24，0跳过；与完整 browser 重叠，不叠加数量 |
| 首轮 `browser-final` | 219 tests / 195 pass / 24 fail，完整失败记录保留 |
| 修正后 `browser-fixtures-final` | 219 tests / 214 pass / 5 fail / 0 cancelled、skipped |
| `maintenance-screenshot-retry` | 原样单项1/1通过，源码前后与当前 SHA 一致、原1600ms时限保留；不是新的完整 suite 通过结果 |
| `core-final` | 30分钟终止、exitCode null、totals为空；TAP前缀到841不构成完整统计 |
| `core-hang-probe` | 4 tests / 2 pass / 1 fail / 1 cancelled，不是通过 |
| `core-bounded-final` | 全246文件参数、4并发、显式60秒默认 timeout；含人工终止的 runner 汇总1741 tests / 1605 pass / 123 fail / 11 cancelled / 2 skipped / 0 todo，exit1 |

bounded core 从2026-10-10T08:12:22.293Z执行至08:32:17.976Z，原始日志有最终 TAP totals，与 JSON 逐项一致。246个文件参数与当前 `tests/unit`、`tests/integration` 的全部 `.test.ts` 文件逐项对应，无遗漏或额外路径。计数是 runner 的实际汇总，包含子测试与文件失败记录，不是1741个全部正常结束的用例。`work-lease-handoff.test.ts` worker在设定60秒 timeout 后仍未退出；保存的 `core-worker-termination.json` 绑定精确 PID343700、父PID341804、创建时间08:20:15.709075Z和完整命令（含该测试文件及 timeout 参数），终止请求08:32:17.8322469Z、终止08:32:17.9378600Z，随后 runner 输出汇总。主代理重新核验后只终止该隔离 worker；本代理核对保存记录及执行时序，未冒充本代理成功读取实时 CIM（独立 CIM 查询被拒绝）。该文件未正常完成，**不能把此汇总称为全部246文件正常、无干预完成或完整验收通过**。失败、取消与2项原有平台跳过均不转为通过，也没有改产品或吞掉 EPERM。

最终 core 日志 SHA-256：`f0e5ce1b4923f57f5f5cfa6bdc9eab51111c5584c4201a35e7b0d4d0d9c8e3e9`，与报告字段一致；报告 SHA-256 为 `955343384f4e18a71e6b8cfc8abbd308e209a193747be91177ea49e80b5f5ae6`，终止记录 SHA-256 为 `88ac1236a27b5cecd1599d92c53aa1b9c18dafef5b8a8728cd9600fc4d0042a3`。

完整 browser 的4项 EXB16 导出保存 ACK 仍失败；另1项 MUI73-10 的直接错误是 `page.screenshot` 超过1600ms，不能据此认定为布局失败。原名称、原源码、原时限及原断言单项重跑通过，支持偶发截图采集超时的判断，**不将独立重试与整套报告合并推导为215/219或全部通过**。完整失败日志 SHA-256 为 `74e6da6132b35c58a960afe83550cd54575ad1c590aa7a524a08e8591f335fa7`；重试日志 SHA-256 为 `16053f6cff7dd3044f37eb1571fe15455ac2d4af87f8e7e559beb2234311fefc`。

夹具与 generated 指纹变更已单独代码审核：两个 lease importer 只规范化 Windows 路径；API Key 的 Chromium 原生 undo/redo 按宿主键处理，Darwin 命令路由断言保留。命令目录只有9个 sourceHashes 更新，两个平台命令列表及其 SHA 不变。它们不能替代 macOS 原生验收。

RED、Scene修复前失败、前两次 GREEN 的失败、`native-local-01` 至 `06`、完整 browser/core 失败均原样保留。没有以新结果覆盖旧失败或把取消、超时当作成功。尚无 HEAD 同场景完整复验，不能笼统宣称完整回归失败全部为已证实的历史基线问题；历史报告计数即使相同，也不足以证明失败逐项同因或没有新增失败。

## 台账与最终限制

独立移除本次新增 `workspaceSurfacesDevelopment` 顶级字段后，`requirements-traceability.json` 与 `migration-map.json` 解析结果分别与 HEAD 相同；原 requirements、mappings 及状态均保留。新增记录限定有限 UI 范围、`fullAcceptancePassed=false`，没有升级业务/物理输入法/多平台/安装包验收状态。

当前证据支持 SURF-01至06 的既定有限 UI 检查通过，SURF-07 的完整回归条件未满足。两个台账补入最终 core 汇总后再次核对，原 requirements/mappings 解析结果仍与 HEAD 一致，`fullAcceptancePassed=false`。必须保留完整 browser/core 的未通过、人工终止文件及平台限制；本文件不授权把完整验收改为通过。只读 `git diff --check` 返回0。

## 追加终审：目录同步修复后冻结版本（2026-10-10）

本节追加后续证据，不覆盖上文native07、旧完整回归及失败历史。**最终有限UI、Windows工作台与本次目录同步相关回归的证据审核通过；完整验收仍未通过。** 本代理没有修改产品或测试，仅补充审核文档；未扩大冷源、头像、macOS等修改范围，也未把尚未回答的范围选项当作用户确认。

`native-local-08/windows-electron.json` 从08:55:18.657Z至08:56:47.098Z，实际win32/Electron44.6.0/Node24.21.0，39个检查记录、errors为空、status passed。13个sourceHashes与当前文件全部一致，四个UI产品指纹与已通过UI code review一致，五个后端产品指纹与最终Windows code review一致。源列表包含两个执行/前置脚本及lockfile；执行脚本仍新建隔离temp根，断言正式协议、实际数据根和零模型，renderer离线，未注入设计样式或替DOM。这些是绑定脚本版本的运行断言，报告没有独立保存bootstrap原始快照或pre-launch/after-run双份哈希，不虚构额外证明。

原生报告的bundleHashes实际为178项；当前逐项核对177项匹配，1项已不存在。扫描递归包含两份 `dist/root-startup-test-*` 的core测试产物：`6ec87fdc-7ab8-446f-980c-f9d940ed66f9/index.cjs`仍在且匹配，`fa5a0385-9f3b-4bfd-ad94-bde99d78f6a0/index.cjs`已经测试清理。它们不是package.json指定的正式main、build-desktop的五个输出或协议静态资源。因此准确计数是**178扫描项、177当前匹配项，其中176为五个正式dist入口加171个.next JS/CSS资源**，不声称178/178均匹配或177项全为正式产品。176项正式构建全部匹配，不以删除/重写原报告消除临时产物。实际加载的173个 `out/_next/static` 文件（含字体/map）与对应 `.next/static`全部一致；`out/index.html`与`.next/server/app/index.html`一致，仍为 `0a8ea9d113daf82cc7b19d19f8592c558472d275a61a65077a4fd4efc3e8e34d`。正式加载路径仍为 `dist/main/index.cjs` 与协议的 `out`，没有新安装包验证结论。

独立实际查看native08全部六张PNG（空态、规划、试验场、场景、候选稿、正文split），各文件SHA与报告记录一致。三栏淡色、右侧真实业务表面、无亮槽的细线及正文两列结构符合批准v3，颜色固定为导航245/238/220、AI250/246/232、内容248/243/228，结构线216/203/166。13组几何记录横/竖厚度最大差0，最大相邻边缘误差0.00006103515625 CSSpx；zoom/DPR取整、caption安全区和结构边框约束与前轮一致，不把声明1 CSSpx误记为所有缩放恒定1设备px。真实主题往返、原Monaco模型/选区替换与undo、CDP组合输入、拖拽/键盘resize、显隐/窄窗/重开检查仍执行。AI折叠残宽0.46875CSSpx×DPR1.5=0.703125设备px且分隔0条，导航折叠0宽且分隔1条；脚本还断言全屏ARIA。六张PNG都是三栏态，不冒充全屏截图；组合输入仍是合成Chromium输入，物理Windows IME及macOS未执行。39记录仍是13几何、6截图及20其他检查，不等同39独立业务用例。

本次EX16-15只把Windows无法构造创建拒绝的chmod夹具改为真实ACL：新mkdtemp根先核对绝对路径、专用前缀、真实父目录为tmpdir；通过whoami取得当前用户SID，execFileSync参数数组仅对该根 `/deny *SID:(WD,AD)`，没有递归参数/继承标记或shell拼接；真实wx探针必须EACCES/EPERM。finally移除该根对当前SID的deny，再由原fixture清理；原保存失败、固定EXPORT_WRITE_FAILED、原文keep及仅old.md的断言均保留，非Windowschmod分支未放宽。源码审核无blocking。提供的ACL独立probe日志记录win32真实EPERM、aclRestored=true、directoryRemoved=true；本代理核对日志与源码，未另执行ACL修改。最终 `tests/unit/file-export.test.ts` SHA为 `3fbe99f83da87f2eef52c0a2c6f4d4b4adeb3673e4f0e82752bfa3a53ca5998c`。

已核对本轮原始结果与哈希：

| 证据 | 实际结果与限制 | SHA-256（原始日志） |
| --- | --- | --- |
| directory-final-affected-acl.log | 146 tests / 146 pass / 0 fail、cancelled、skipped；包含原EX16-09、EX16-15和WDS-08-race。主代理标注15相关文件，TAP本身没有独立命令/源hash元数据，不据此推断额外执行范围 | 7644747e3674320d3eb33ff34f5926595f2ff45d7280aa7895693b1c2b3644e0 |
| browser-export-sealed-final | 冻结后原file-export浏览器文件7/7，exit0；JSON命令、统计及日志哈希一致 | 0bfcf70c577bc76095dee844db626fd746ae48fa1f59b1921896b7216f1fe4f9 |
| browser-windows-directory-final | 全30浏览器文件参数与当前清单相同，219/219、0失败/取消/跳过、exit0；启动后cleanup修复，属混合快照观察，后续冻结7项不能合并成新的完整冻结suite | 00758e4b44c4a87833169f519f50414e0e1bc17994beac415458d63fa8b0edb9 |
| core-windows-directory-final | 全248 unit/integration文件参数与当前清单相同，1746 tests / 1697 pass / 44 fail / 3 cancelled / 2 skipped，exit1；混合快照诊断，未通过 | 14d2551abc4856fdc8f885882c02d9bcea3582e1a0aa633485b5749489819aa0 |
| core-process-spawn-retry.log | 原3文件相关22/22、0失败/取消/跳过；只有TAP日志，未见同名JSON，不推断额外命令元数据，不覆盖完整core失败或认定其全为环境原因/无新增 | f96bb1b0643b502da1c5d9a206f59054e574aa8d2edf092159a565f37f728c1d |
| typecheck-acl-fixture-final、foundation-directory-sealed-final、desktop-directory-sealed-final | JSON及空日志hash一致，均exit0；TypeScript绑定最后ACL夹具版本，后两项在cleanup产品冻结后完成 | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |

native08报告SHA为 `c20ffec6bf3806ab14ac362ea3e9ed839b62b76debb81be8ace8057733453997`；完整core报告SHA `721b5625e9c42369fbf4bf5adcb9b2ad8117218e969de4692c4d5460d8188362`，完整browser报告SHA `14f4574f329e9fcc44a75ba618c79ad398ce8be2c1db482184f0cc7634713f76`。新结果未删除或覆盖此前RED、native失败、全量失败、取消和重试历史。

最终再次只读核对两份台账：移除各自 `workspaceSurfacesDevelopment` 后，解析结果与HEAD原文件完全一致；该有限记录均保持 `fullAcceptancePassed=false`。当前可以交付本次UI及限定目录同步修复的实现/测试证据；完整核心仍未通过，不能写全部测试通过后的完成总结，不能升级物理IME、多平台、全部业务或安装包验收。
