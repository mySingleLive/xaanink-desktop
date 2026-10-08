# 迁移进度屏幕实现交接（待独立审核）

日期：2026-10-08。作者：product_review；本文件不自行评审PASS。

本批仅新增RootMaintenanceScreen、相关browser测试，并在已有 `src/types/desktop.d.ts` 添加可选维护桥接类型。没有修改main/preload/Home、原工作台或共享状态协议；共享两个pending phase由主代理修改，组件使用当前协议。

交接合同为 `docs/evidence/implementation-12/root-maintenance-screen-contract.md`。具名组件无props，先subscribe后state、revision严格递增、effect连接隔离、同步pending防重。动作权限只读main.canCancel/canContinue；所有网络/FS/目录授权/迁移执行都留在main。错误使用固定本地提示；路径纯文本，操作失败保留当前权威状态。两个显式pending phase分别告知旧目录清理、新目标回滚的真实待处理数，recovery-required不混称可继续。

界面使用原Button/实际BaseUI、宣纸玄墨语义令牌和原字体族，顶部保留desktop-drag；没有复制系统按钮或正常工作台桥接。窄窗长路径断行不产生横向溢出，并以实际浏览器滚动证明按钮可进入可视区。已读取安装版Next16.2.10的use-client章节，组件浏览器状态与生命周期位于Client Component；传输type import在浏览器bundle中擦除。

## TDD与作者验证

| 证据 | 真实结果与性质 |
| --- | --- |
| 01-environment-missing-browser | 默认Playwright1243浏览器未安装；环境失败，不计行为RED |
| 02-environment-sandbox-browser | 已有1228启动受sandbox Mach port限制；环境失败，不计行为RED |
| 03-behavior-red | 仅mounted标题的最小组件；12/12真实行为失败，0编译/夹具错误，exit1 |
| 04-green-attempt | 11/12通过；RUI12-12夹具内函数被tsx变为未定义__name，明确非产品缺陷，之后搬入esbuild harness |
| 06-green | 12/12通过，exit0；窄窗用例同时修正为保持长路径进行实际窄化 |
| 07-unavailable-quit-red | 初读失败时缺quit按钮，1/1实际行为失败，exit1 |
| 08-final-green、09-final-typecheck | 第一版13/13及fulltsc0；保留历史，尚未包含后来的显式pending phase |
| 10-pending-phase-red | 新shared phase无法显示，1/1实际行为失败，exit1 |
| 11-pending-and-unavailable-busy-red | 新phase仍不识别，初读失败quit清error后busy按钮消失；2/2实际行为失败，exit1 |
| 12-final-green、13-final-typecheck | 最终14/14，0失败/跳过/取消、exit0；全量项目tsc0、空诊断 |

05-typecheck为早期全量检查，只报其他代理两处test类型问题；未把该次exit2算为通过。最终13日志已独立于该历史错误实际取得exit0。

## 14项行为覆盖

RUI12-01订阅/初读顺序及old/equal revision；02六个活动阶段和不定进度；03真实计数/已知零/路径转义；04main取消权限及同步双击防重、不乐观完成；05安全错误、authority保留与显式重试；06受限continue/quit与pending禁重复；07显式清理未完成与四终态区分；08初读失败保留同步订阅进度；09卸载与迟到读/事件/命令隔离；10实际React StrictMode effect替换；11实际语义CSS、原Button、主题/字体/拖动预留/窄窗长路径及按钮可视；12没有维护bridge时不调用工作台bridge；13无初读快照仍可受限quit且pending可见；14两个pending phase的准确目录、数量和可继续语义。

测试仅启动本机已有headless Chromium1228的隔离页，当前组件+React19+BaseUI1.6+原Button实装，受控维护bridge，拦截外网。宣纸清理待处理、玄墨、360px长路径截图已视觉检查，位于implementation-12。没有接触运行中Electron或真实用户根；不提升正式测试用例状态，不宣称真实Windows/native/app.relaunch/迁移通过。等待他人独立审核与主代理组合验收。

复现命令：使用Node24，设置 `XAANINK_TEST_CHROMIUM=<user-home>/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`，执行 `node --import tsx --test --test-reporter=tap tests/browser/root-maintenance-screen.test.ts`。设置 `XAANINK_TEST_SCREENSHOTS=1`可重建三张受控截图，默认独立复跑不覆盖已冻结截图。浏览器须有正常Mac进程权限；没有依赖远程服务。全量检查为 `node node_modules/typescript/bin/tsc --noEmit --pretty false`。

## v2 · 独立审核修复交接

第73轮审核者的MUI73-06真实RED指出：higher revision的copiedFiles7/totalFiles4替换了前一合法1/4，文字显示7/4、native progress却钳为满条。作者仅在isState加入known total下copiedFiles<=totalFiles守卫，保留null未知总数和0/0；没有修改审核者10项断言。作者合跑14+独立10=24/24（14-review-fix-green.tap）及fulltsc0（15-review-fix-typecheck.txt），未自行宣布73通过。

独立审核者随后只校正其长路径fixture为精确4096字符（此前3279字符，不计产品缺陷），最终review73-06-final-4096-green.tap为24/24、review73-07-final-typecheck.txt为空诊断exit0；其10项测试SHA单列于v2清单。v1冻结原样保留，新v2等待审核者指纹核验与独立结论。有效状态的视觉没有改变，原三张受控React截图保持原文件。
