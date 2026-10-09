# 空右侧内容面板收起按钮独立 code review

2026-10-09（Asia/Shanghai）。只读审核本次 `ContentTabs.tsx` 产品 diff、新增浏览器用例、150–153方案和指定桌面窗控/样式/窗口初始化。读取现有RED及聚焦GREEN日志；未运行测试，未启动应用，未改实现或用例。

修正后结论：**通过；产品实现及本轮浏览器用例未发现未解决的阻塞错误。** 完整套件及真实 Electron harness 仍由主代理执行，Windows 原生目标机未执行不计通过。

## 发现项及修正复查

- **[P2] env矩阵应保留真实菜单表达式。** `tests/browser/empty-content-hide.test.ts:114` 直接手写整条 `.desktop-windows-menu` right 规则覆盖产品CSS；当前文本与 `src/app/desktop.css:10` 一致，但若产品菜单 right 中的常数或计算式变更，这个注入分支会测试手写的旧表达式，无法证明真实菜单与新增按钮的相对位置。150/152要求只替换真实 env 读取、保留剩余计算。建议读取当前真实菜单规则并仅将 `env(titlebar-area-width,` 替换为 fixture var；也可在覆盖前明确断言待注入原表达式与产品一致。新按钮行123的注入已经从真实 inline style出发，可保持。无需因此修改产品实现。

  **已解决。** 主代理改为读入一次真实 `desktopStyles`，EMPTY-04从该源码提取 `.desktop-windows-menu` 原规则，断言其env读取存在后仅替换 `env(titlebar-area-width,`；其它菜单定位/尺寸/层级表达式保持真实来源。本代理只读复查确认，不再有手写菜单表达式覆盖。修正后 `/private/tmp/xaanink-empty-hide-green-final.log` 已完整结束，22/22通过，无失败/跳过；本代理未另跑测试。

## 已确认的实现与测试

- 唯一产品diff是 `ContentTabs.tsx`：新增现有desktop store订阅、仅替换零 Tab拖动条（71–90行）。空工具条使用h-11/flex/justify-end/px-2，原生button名称/title/type完整，移除祖先aria-hidden，PanelRight沿用已有图标系统，直接接入既有onToggleContent。未增加模型、模拟作品、IPC、HTTP服务或独立布局；有Tab/正文分支保持。
- 第76–78行只对win32增加padding，env值与138/zoom保守最小值取max，再加40px；与 `desktop.css:7,10` 的固定菜单28px+右距6px+间隔6px一致。desktop bootstrap更新会刷新zoom，Web/macOS保持8px默认边距。desktop.css的button no-drag规则保持有效。
- 第85行添加可见焦点outline。浏览器EMPTY-02（87–90行）经真实Tab导航到产品按钮，断言activeElement与实际outline，再按Enter/Space；没有用直接callback或脚本focus代替键盘行为。
- 浏览器真实 `ContentTabs`/`WindowsMenuControl` 和编译后的Tailwind/desktop CSS被挂载；仅无关正文/保存层及小说缓存隔离，所有网络路由abort。contained断言实际按钮可见、在面板及工具条内、顶行y=0、button no-drag/工具条drag。
- fallback矩阵45组（3宽度×5zoom×3字号）使用未经替换的产品表达式；env矩阵48组（2宽度×3zoom×2字号×4占区）覆盖实际几何，菜单读取来源已按上述修正。两者均检查新增按钮在原生预期占区左侧、在固定菜单左侧至少约6px；属于浏览器布局合同。
- EMPTY-05确认有Tab时空按钮不存在、原收起按钮唯一、全屏回调及逐个关闭后空按钮可用。它只证明组件宿主；真实DashboardShell最后Tab自动收起及AI恢复须按152另验。
- `/private/tmp/xaanink-empty-hide-red-final.log` 为8/8实际断言失败，均为可访问按钮count 0而期望1，未混入浏览器启动/依赖失败。`/private/tmp/xaanink-empty-hide-green.log` 已完整结束，22/22通过（新8例+既有窗拖/安全区回归）；这是主代理执行日志的独立读取，不是本代理另跑结果。

## 原生 harness 追加源码审核

只读审查新增 `scripts/smoke-empty-content-hide.mjs`、它引用的既有 `seed-electron-fixture.ts`，以及隔离启动路径、数据库代理和分栏依赖的相关源码；仍未启动UI/执行测试。**修正后harness源码审核通过，产品及浏览器审核结论不变；实际原生执行结果仍待核对。**

- **[P2] 48行动画结束条件无法反映动画状态。** `openEmpty()` 检查 `.workspace-content` 的inline style不包含 `min-width: 0`。当前react-resizable-panels（`node_modules/react-resizable-panels/dist/react-resizable-panels.js` 的Panel渲染）将传入className放在内层内容div，其style为maxHeight/maxWidth/flexGrow/overflow/touchAction；minWidth:0在外层常量po，且不代表DashboardShell的minSize/animating。因此该条件从动画开始就可能成立，不能证明560ms展开spring结束。请用真实面板/按钮几何稳定等待，覆盖完整展开动画再确认若干帧尺寸位置稳定；重启初次inspect及zoom/font变更后的inspect也应等待几何稳定，避免截到过渡帧并把它记为稳定布局。

  **已解决。** 主代理移除private CSS判断，新增waitStable：按requestAnimationFrame读取实际.workspace-content的width/x，要求可见宽度>200、连续8帧差异<.001。openEmpty在面板开始展示后调用，每次inspect再次调用，因而覆盖首次展开、重启恢复以及zoom/font改变；本代理已只读确认各调用点。该等待观察真实几何，能够避免原条件的即时通过问题。
- 启动与隔离方向正确：mkdtemp的data根通过XAANINK_TEST_ROOT传入Electron；`desktop/main/index.ts:56-67`和`brand-startup-paths.ts:27-35`在此分支只选择该根与其-bootstrap，脚本再断言bootstrap.dataRoot吻合、models零和初次novels空。seed helper在明确的directory/data与directory/work建立真实合成作品；src/lib/db.ts使用scoped client，未见默认数据库路径访问。
- harness完整加载真实开发构建、本地xaanink协议；鼠标/键盘操作真实按钮，appearance通过真实window.desktop.settings IPC且校验native getZoomFactor。hidden等待.workspace-content卸载并检查恢复入口、原生窗口位置/大小/最大化/全屏状态不变，能证明原有DashboardShell回调和动画卸载而非组件mock。
- keyboard包含Shift+Tab/Tab回到实际按钮、activeElement和可见outline后Enter/Space；最后Tab流程点击真实树节点、关闭真实Tab、等待自动收起，再AI恢复空面板并再次收起；符合152澄清后的行为。
- CUA gate等待主代理用系统鼠标操作并提交ack及原生截图，脚本只检查ack与图片存在；必须结合实际CUA工具记录审验，单独ack不能证明系统点击。执行时须确认固定2200×1000窗口中的按钮坐标确实位于显示器workArea内，并把ack截图保存到成功清理隔离目录后仍保留的位置。
- renderer截图命名和report scope明确区分DOM截图、CUA原生截图、macOS开发验证、Windows原生未执行与安装包未执行，证据陈述正确。源hash能关联本次源码；实际结果报告仍待执行后审核。

以上harness判断仅依据源码，不是原生验收通过证据。

## 后续验证状态记录

主代理披露首次完整browser与UI构建并行产生4例旧测试的.next/chunks ENOENT，原始日志保留。本代理读取 `/private/tmp/xaanink-empty-hide-browser.log`，其终态为171例、167通过/4失败，不把该轮记作通过；UI/desktop构建后主代理已开始串行完整browser重跑，本轮读取final日志时尚无终态统计，仍待结果。

后续只读确认 `/private/tmp/xaanink-empty-hide-browser-final.log` 已完整结束：193/193通过，0失败、0跳过。该结果来自构建完成后串行重跑，不抹除首次失败日志；本代理未执行测试。

首次typecheck的 `menuRule` possibly undefined来自新增测试的条件链未对变量明确收窄。当前源码已先assert(menuRule)，再assert原表达式包含env，两条断言后调用replace，运行逻辑和真实CSS读取来源不变；本代理复查确认。主代理报告修正后typecheck通过，`/private/tmp/xaanink-empty-hide-typecheck-final.log`只有tsc调用、没有错误；最终命令退出状态由主代理保存到验收证据。

## CUA路径消歧追加审核

主代理报告第一次CUA按仓库Electron路径选择时，同一路径同时有两个进程，选中了既有旧窗口；没有执行点击或保存截图。第一次隔离gate的state/log保留，停止范围限于新测试进程18869/18878，既有6810未动。这一轮不计原生点击或截图通过；上述进程操作来自主代理陈述，本代理未执行进程操作。

只读复查当前harness的应对修改：`createRequire(import.meta.url)('electron')`定位本仓库已安装runtime可执行文件，向上三层定位Electron.app；用fs.cp在本次mkdtemp下建立独立bundle并保留symlink目标，`_electron.launch`明确传入该独立bundle的executablePath，gate state同时输出isolatedBundle供CUA按绝对路径选择。它不下载或安装runtime，不修改产品代码或旧bundle，成功后在app关闭后清理整个临时目录。此修改符合本次隔离原生验证范围，**源码审核通过**。

后续必须以新的isolatedBundle绝对路径匹配CUA目标，并确认gate pid/窗口几何/实际截图对应本次空root；只有实际系统截图与鼠标点击、harness卸载断言共同完成才计原生通过。不能沿用第一次选错窗口的状态作证据，也不能仅凭gate ack计通过。实际新gate执行结果仍待审核。

## 重启用例边界修正审核

主代理保留 `docs/evidence/implementation-47/native-initial-restart-expectation-failure.json/.log`，披露实际原生运行在重启后直接等待“隐藏内容面板”按钮时超时。本代理读取失败JSON确认：此前已记录真实系统鼠标收起、Enter/Space收起、10组native zoom/font布局和重启前可见布局，pageerrors为空；报告最终status为failed，不能当作完整EMPTY-06通过。

只读核对 `src/lib/desktop/draft-recovery.ts:218-220`：恢复后tabs为空且原layout.contentVisible为true时，原layout保留为TARGET_UNAVAILABLE，提交WorkspaceDraft.layout=null。该既有策略有意避免无有效Tab时恢复展开内容区，本次加按钮没有要求改动它。用例原先预期空面板跨重启继续可见，超出了真实既有恢复合同；调整验收边界合理，不构成放弃用户的新增按钮目标。

当前152的EMPTY-06及harness已明确：默认外观关闭重开后按既有恢复规则显示零Tab收起状态和AI恢复入口，随后通过真实AI按钮展开空区，waitStable/inspect新增按钮，再实际点击收起并检查原生窗口状态。源码复查确认此流程仍使用完整DashboardShell和真实IPC，没有修改draft-recovery或产品布局状态，**修正后的重启用例和harness审核通过**。完整修正后原生运行结果仍待终态报告。

初次失败JSON的native截图引用有hash；重跑会输出同名截图。执行时应归档初次原图再覆盖，保证保留失败证据能够按原hash核对，不把重跑图误认作首次证据。
