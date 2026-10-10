# Windows 顶部对齐及关闭图标加粗验证

日期：2026-10-10（Asia/Shanghai）。范围为用户最新两项要求：三栏顶部所有按钮与原生窗控垂直对齐，关闭X加粗。原生高度仍32 DIP；真实Sidebar/ChatPanel/ContentTabs及原有导航、内容Tab、关闭保存路径继续复用。此记录不代表完整业务或正式W03/W04验收通过。

## 实现和独立审核

DesktopApp同步caption zoom；Windows顶部行与按钮/SVG采用反zoom尺寸，中心16 DIP。有Tab和空内容区都覆盖，平衡顶部/底部边线，并将真实窄工作区导航移到底部。Web/mac原44 CSS px顶部保留。关闭加粗使用属于owner的透明BaseWindow/ImageView，仅绘制X、无renderer及业务数据，鼠标穿透，原生命中/悬停红背景/最大化/Snap/关闭流程保留；颜色、OS scale、内容区bounds及可见性同步。

方案、测试用例、代码及三处旧fixture支持均有独立审核，见本目录同名前缀的plan-review、test-review、code-review、fixture-supplement-review。后者仅在三个非绘制unit fixture隔离新增装饰依赖，保留全部原业务断言；关联窗体38项33通过5失败，未称基线无关。后续原图发现初版10×10 host正常窗口偏上两行，追加geometry-plan/test/code-review：最终整cell覆盖46 DIP，normal top1/高31、max top0/高32，完整透明canvas按OS scale绘制。owner的dipToScreenRect补偿client和独立host原点的整像素舍入相位；相位/高度参与缓存、DPI改变重设shape、hover包含max顶部第一DIP。最终CLOSE独立10项由主代理及独立审核分别执行通过。

## 自动验证

实质TDD RED：ALIGN五项中三项失败，记录真实中心错位/窄导航位置；三处CLOSE接线用例在未接线时全失败。整cell修正另保存旧真实geometry的1项行为RED、10项5通过5失败的实现前记录。缺新增helper/沙箱spawn EPERM不计像素行为RED。原图定量比较属于后续机械校准，不冒称原先像素TDD。

首次关联组合49/49通过；整cell最终CLOSE 10/10通过。最终关联52项、完整core/browser footer及来源SHA以 `docs/evidence/caption-alignment/verification.json` 为准。旧core/browser保存为before-cell，不能与新源拼接。最终browser使用既有Chrome，明确XAANINK_TEST_CHROMIUM；最初漏设路径导致207项hook环境失败，单独保留browser-missing-runtime，不计产品行为验证。完整失败/取消/跳过都保留，不按通过处理。

最终相关52项全部通过（逐个从最新完整core/browser提取，不把矩阵场景重复加计）。完整core：1741项，1601通过、125失败、13取消、2跳过，exit1，246文件，1201747ms。完整browser：212项，184通过、28失败、0取消/跳过，exit1，29文件，372544ms。较早完整core为1739/1608pass/123fail/6cancel/2skip、browser212/187pass/25fail，保留为before-cell；本次结果未证明额外失败是基线或与修改无关。

core的隔离work-lease-handoff worker输出全部22项结果后仍保留句柄。超时392秒时现场核对worker→test runner→本次runner父链、创建时间及无子进程，才终止该直属worker；只计其实际失败/取消，未停止用户应用或其他任务，见core-file-timeout-geometry.json。最终footer是完整关闭后的结果，不是部分输出推算。

bundled Node v24.19.0、TypeScript新几何检查exit0；完整生产UI构建exit0（随后renderer未改），新几何desktop构建exit0。Windows x64 NSIS结果为package-geometry.log，包内314项目资源验证完成。原命令catalog仅因CRLF原始SHA不一致而暂转LF；九个源文件的LF hash精确等于原catalog，不改逻辑，测试后恢复原始字节；generated routes亦验证原hash后恢复。恢复记录和完整运行来源在verification.json中逐项列出。

## 本机真实Windows与最终包

仅使用本机Windows、Electron 44.6.0、OS scale1.5。隔离seed目录无作者数据/Key/模型；Playwright负责启动、设置renderer CDP offline和只读采样，另有透传wrapper记录真实setTitleBarOverlay调用、不触发UI。所有鼠标/键盘输入通过Sky。CDP offline不是系统全网断开证明；用户已有开发窗口未操作。

机械原图关闭层开/关：normal bbox均[874,12,883,21]、暗像素23→38；max均[2532,10,2541,19]、20→41。每组关联sourceHash、requested/actual/content/ImageView、转换与phase；只读解码原JPEG，无裁剪/缩放/改图。JPEG阈值不能证明精确物理线宽。机械moved尝试未改变bounds，不作为拖动通过。

最新包geometry-*采样保存main/source SHA，只有匹配当前main的样本进入verification.json。normal关闭bbox[1414,12,1423,21]、max[2532,10,2541,19]均匹配对应原生位置，暗像素各49；原图geometry-normal/max/restored.jpg证明单个加粗X，normal/max/restore及红色hover实际操作。hover原图指针遮挡部分X，只支持红底和可见白色，不作完整hover glyph像素结论。全部可见顶部button/SVG中心16或16.1667 DIP；最小化/全屏与恢复另有JSON，min/min-restored实际cursor都1886,240（关闭区外）、恢复原bounds且装饰重新可见。原生X点击正常退出，native-geometry-session driver/application都exit0。geometry-moved尝试未改变bounds，不作实际拖动通过。

以下为整cell修正前同轮较早包/开发版的有限结果，不能扩大为最新包全部状态复验；原有保存/命中路径未改，但截图本身仍是旧迭代。

- 较早包正常三栏有Tab时所有可见顶部button/SVG中心为16或16.1667 DIP；三条标题高32 DIP，菜单中心16 DIP。`native-packaged-paper-final.json`和原始`packaged-paper-final.jpg`对应修正前宣纸状态；玄墨、空/有Tab、隐藏/恢复侧栏与内容区另有JSON/截图。旧开发采样选择器未包含真实Chat header全部button，不能扩大它的DOM测量范围；较早包采样已直接选全部caption标记下的button/SVG。
- 实际75%、100%、200%应用zoom，200%窄布局底部工作区导航及切换已观察；真实字号只14，三字号/五zoom的广泛组合是受控真实组件浏览器测试，不是多台OS验证。renderer/主进程zoom与caption rect都有JSON，不把模拟env称OS结果。
- 原生最小化使装饰隐藏，激活恢复同bounds后重新可见；此较早JSON未独立记录cursor，不能说固定cursor已实测。F11原生全屏隐藏，退出恢复可见；宣纸/玄墨/跟随实际系统dark主题、红色关闭hover已观察。较早小host的单X结论随后被像素分析纠正，最终几何以geometry-*为准。没有精确Codex像素测量或跨DPI视觉一致性结论。
- 较早包Ctrl+O打开真实原生目录dialog时，owner `enabled=false`、装饰隐藏；Escape取消后enabled=true且装饰恢复。`native-packaged-dialog-open/cancelled.json`。最初一次菜单子窗口点击坐标错误，仅保留为attempt，不算dialog通过。没有保存含私人目录列表的dialog截图。
- 较早包hover原生最大化按钮实际弹出Windows Snap菜单，`packaged-snap-hover.jpg`；只证明菜单入口，未遍历拖动/吸附布局。关闭X hover红背景白色粗X、真实native click正常退出；装饰没有截获关闭点击。`packaged-close-hover.jpg`及三个较早native session关闭/exit0记录。
- 较早包编辑隔离章节输入验收marker时界面为待保存，点击native X退出，再用同目录较早包重启。原正文不含marker，但隔离journal staged与recovery两处均含marker（只保存path/bool），真实设置→保留的草稿→滚到末尾可见完整marker：`native-close-journal.json`、`packaged-retained-draft-marker.jpg`。源码`src/components/content/api.ts`的apiSend→tryStageRequest以及CHAPTER_CONTENT白名单证明原有暂存返回合成回执，原正文不会自动覆盖。因此只确认该轮草稿持久保留并可重启查看，不称最新包直接正文数据库提交或全部关闭错误/取消分支通过。

## 交付和限制

最终安装器：`release/XaanInk-0.1.0-win-x64.exe`，276571859 bytes；SHA256 `5c17d54b6bbd84f5d9878314c1132f358fac407c95cd919eb02dbadc3c0d2270`。最终desktop与包内main SHA256均 `8935653ae32a3760dc616cbe127b16cd913a443d5c5c485804086fc71d5bd400`；最终accent源SHA256 `4c2620e63e5c213c0b9431bdcaebdd073db2ba7bbe560f2c79682a8b8afc9b23`，与新core/browser和原生采样一致。package-geometry实际session exit0。最新native X关闭后driver/application exit0，所有测试与验收session已结束。

产品源码与最终core来源一致，桌面dist/main与最终包resources/app/dist/main字节一致。包的实际unpacked exe已运行；NSIS安装器没有执行，不称安装/升级验收通过。setShape是实验性API，固定Electron布局没有覆盖其他版本/RTL；没有多屏、其他真实OS DPI、跨应用遮挡/失焦完整矩阵、全部钳制区域点击、快速hover逐帧/pressed像素同步、真实maintenance/relocation窗口或完整关闭失败/取消矩阵。正式W03/W04及29类业务验收保持原状态，全量失败不可忽略。

证据目录为gitignored运行产物；可追踪本报告/独立审核/代码与测试源。最终审阅见 `2026-10-10-caption-alignment-verification-review.md`。
