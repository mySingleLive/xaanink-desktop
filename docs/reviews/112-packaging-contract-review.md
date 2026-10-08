# 112 · 安装包技术合同独立审核

2026-10-08。当前结论：**PASS_LIMITED_PACKAGING_TECHNICAL_CONTRACT_V3**，仅通过配置、macOS arm64实际 `.app` 构建及静态文件/依赖/资源验包的技术方案。该结论依据文末v3复核，不代表实施、实际构建、代码审核或平台验收通过。首版结论为 NEEDS_REVISION，原问题及v2过程在下文保留。本轮只读合同、源码与已安装工具，并调用 builder 的纯文件匹配器；只修改本审核文档。没有运行 build、packager、PG、Electron、签名、公证、付费调用或安装验收，没有读取默认用户数据目录。

审核对象为 `docs/evidence/implementation-39/packaging-contract-draft.md`，SHA256 `701d40890411563142d606d49af972f9e8ecd1b0d996f1bf7de88a20f32da390`；依据 `docs/04-technical-design.md` 第10节，整文件 SHA256 `c6f1e0330a4bf50a7b7a5b9578535feab47f6aa74f75fd645314b7ea0268b786`。用户取消备份之后的范围优先；旧“531”不能覆盖当前有效台账的530项，更不能把历史开发证据升级为安装验收。

## 需修订的边界

### R01 · P1：打包版验收必须先确定完整隔离，本轮不得执行默认真实目录例外

草案允许在“默认位置原先不存在”时把它作为临时安装位置；本轮任务已明确不向真实 `~/.xuanxiang` 写测试数据，这一例外不可成为本轮可执行步骤。后续 fresh-only 策略需要另阶段落实真实交互授权与写入边界，不能把只读 absent 当成自动执行依据。当前 `desktop/main/index.ts:53-57` 从 `app.getPath('appData')/Xuanxiangxiezuo-Desktop` 建立 bootstrap，然后覆盖 `userData`；`:190` 从 Node `homedir()/.xuanxiang` 选择默认业务根；`:196` 再把 `sessionData` 指向业务根的 session。更换 appId、产品名或只传 `--user-data-dir` 不会同时改变这些路径。只隔离 Chromium profile 也不能证明业务根未触碰真实目录。Electron 将 appData、userData、sessionData 定义为不同路径。[Electron 路径 API](https://www.electronjs.org/docs/latest/api/app#appgetpathname)

v2应固定首选“独立测试系统账号下的原样安装包”，其默认 home/appData 都归测试账号；没有该账号就记录原生安装场景待验收。若后续选择生产支持的路径配置入口，应另行明确它对 appData/bootstrap、业务 defaultRoot、sessionData 的首次同步初始化影响并审核，不能增加 packaged 测试环境变量旁路，也不能用 shim、测试 preload、伪造 isPackaged 或预置假 pointer 作为首次安装证明。单靠子进程 HOME 环境值也不能在未验证系统 appData 前宣称隔离。

启动前必须确认测试账号/目录的真实归属、canonical 路径和不存在外部别名；启动后从实际应用状态核对 bootstrap/userData、业务根、sessionData 及新建作品目录均属于隔离范围。任何未知路径立即结束该次验收并保留证据。本审核没有实际尝试这些路径设置。

### R02 · P1：项目白名单与生产依赖闭包需要分别定义

正向 `files` 可以阻止项目根默认 `**/*`，但不能把“所需生产依赖”自动变成审过的运行闭包。安装的 `app-builder-lib/out/fileMatcher.js:172-216` 另建 node_modules matcher，普通字符串只提取负向规则；正向 dist/out 规则不限制生产依赖内容。`npmNodeModulesCollector.js:16` 使用 prod、optional、omit-dev 收集；复制默认忽略部分测试/构建文件，却不默认忽略所有 `*.map`，见 `fileMatcher.js:19` 与 `util/NodeModuleCopyHelper.js:24-41`。官方也说明 package.json 与生产 node_modules 独立收集。[v26 应用内容](https://www.electron.build/v26/docs/contents/)

已调用安装版 `getMainFileMatchers` / `getNodeModuleFileMatcher` 的纯 API，输入五个明确 cjs 入口、out、migrations、LICENSE：项目 docs 被拒，cjs 被接受，但 dependency matcher patterns 是空数组，即自动生产依赖仍按默认复制；没有运行依赖收集命令或 packager。此结果是配置机制核查，不是产品 RED。

v2应定义两层：项目层只包含五个入口、out、prisma/migrations、许可证目录和必要 package.json；依赖层包含从实际 external imports/exports 与锁定 package metadata 得到的生产及当前目标 optional 闭包，并保存包名/版本/路径/散列清单。禁止用整份开发 node_modules 额外拷贝绕过 collector。依赖自身的 map、环境文件、测试和无关材料须有明确负向规则及实际产物核查，保留许可证/NOTICE，不能用 `!**/*.md` 无差别删除 LICENSE.md。

当前 `package.json` 将 next 与 prisma 都列在 dependencies。实际 desktop handlers 使用 `next/server`，而 desktop build 的 Node bundles 设置 `packages:'external'`，故 next 目前有真实运行依赖，不能把它整体排除来满足“不含构建工具”。prisma CLI 是否可移到开发依赖应由实际闭包证明后处理；普通依赖图中 dev 包通过生产路径可达时也不能单凭其名称删除。应把“不含构建工具”明确为不包含项目打包/生成工具与其仅开发闭包，同时列明真实运行依赖例外，避免合同互相矛盾。

依赖 collector 会尝试 appDir/projectDir/workspaceRoot，复制器还处理链接包。最终输入应来自本独立仓库或受控 staging；记录任何真实路径越界并拒绝。实际包内解析必须落在包内，不能借父项目 node_modules 或全局 NODE_PATH。Electron Framework 内部规范链接与指向包外的 node_modules 链接应分别核验，不能用“所有 symlink 一律禁止”误伤原发行目录。

### R03 · P2：固定撤销后入口清单、资源布局与独立输出目录

草案的“三个 service/维护入口”不对应实际 build。当前 `scripts/build-desktop.mjs` 只输出：

| 包内路径（asar=false 的 app 根内） | 实际用途 |
| --- | --- |
| dist/main/index.cjs | 唯一 main；含原迁移/定位窗口模块 |
| dist/service/index.cjs | 普通业务 worker |
| dist/preload/index.cjs | 普通工作台 bridge |
| dist/preload/maintenance.cjs | 正常根迁移维护入口 |
| dist/preload/root-relocation.cjs | 严格定位原目录入口 |
| out/** | 静态 Next export、Monaco worker、本地字体和品牌资产 |
| prisma/migrations/** | 原 migration.sql、0001_init.sql 与 migration_lock.toml |
| LICENSE、licenses/**、必要 package.json | 项目与依赖许可证、运行元数据 |

应逐入口纳入，不使用能纳入旧 entry 的宽泛 `dist/**/*`。撤销的 application-restore worker/preload、退役生产源、tests/retired、design、docs/evidence、开发脚本及 source maps 均不得进入包；正常只读 legacy preflight 仍可在 main bundle 中，不能按 backup 字符串一律否定合法兼容代码。build 已显式移除旧两个 entry；仍须验证实际产物没有残留。

`app.getAppPath()` 用于 out 和 prisma/migrations，`__dirname` 用于 worker/preload。这些文件应保留在 `Contents/Resources/app`（Windows 为 resources/app）相同相对路径；放到 extraResources 而不改 reader 会破坏现有路径。Prisma generated TS 已进 service bundle，其 compiler WASM 从 `@prisma/client/runtime/query_compiler_fast_bg.postgresql.wasm-base64.js` 导入并解码，无需额外复制 src/generated；但必须保留实际 runtime JS/base64 模块。PGlite 自己的 WASM/data 资源另由真实依赖包提供。只检“有一个 .wasm”不构成运行资源证明。

建议明确 `directories.output:'release'` 等与 dist/out 无交集的目录，以及独立 buildResources。builder 默认 output 为 dist，并加入输出排除；但安装版 matcher 按顺序允许后面的正向 dist 规则重新纳入。我已纯 API 核实 output=dist 时显式 main cjs 仍匹配，**不能声称默认输出目录必然丢入口**。独立 output 的目的在于避免宽泛规则收集旧安装产物或递归包内容。应保持 fresh output 的所有权，不为“clean build”删除未知路径。

### R04 · P2：未签名、本地 Electron 与目标架构需要可执行的配置约束

仅“没有签名凭据”不能保证 builder 不自动查找本机证书。安装版 mac 类型明确 `identity:null` 跳过签名；`macPackager.js:288` 和 `dmg-builder/out/dmg.js:65` 都按 null 直接返回。v2应固定 mac identity=null、notarize=false、forceCodeSigning=false、无自定义签名 hook、无发布配置，并使用 `--publish never`。Windows 配置应使用实际支持的 `signExecutable:false`，保持资源编辑以应用图标/版本；不要用 `signAndEditExecutable:false` 同时跳过产品元数据。构建环境不得自动继承上传/签名流程，报告不得输出密钥。未签名开发产物与通过系统 Gatekeeper/SmartScreen 的分发产物不能混称。

安装版 `electronDist` 接受目录或 zip；解包目录不会自动核其二进制架构，hook 抛错还可能落到默认下载逻辑（`electron/ElectronFramework.js:164-217`）。本机 arm64 应使用预先验证的本地 Electron44.6.0 路径，预检版本/二进制架构后再交 builder；拒绝错误架构，不能靠目录名称推断。本机 electronDist 不应全局用于 mac x64 或 Windows x64。后两者本轮只配置、待实际平台工具链/发行二进制/生产依赖，未执行构建不能标为产物存在或平台通过。

本机已安装 sharp0.34.5 的 `@img/sharp-darwin-arm64`0.34.5 与 libvips1.2.4；x64/Windows 的同类包当前不存在。sharp 的 exports 不公开 package.json 子路径，不能把该 require.resolve 失败误判为未安装；本审核通过物理 metadata 与 sharp.node export 路径核实。目标 optional 二进制和 libvips 不能因 npmRebuild=true 而假定完整；需目标安装/重建策略与实际加载、真实图像处理回归。只改 Electron target arch 不会补齐所有 sharp 资源。[sharp 目标平台安装](https://sharp.pixelplumbing.com/install/#cross-platform)

### R05 · P2：有限 native 验收与关闭 drain/cleanup 必须写进合同

草案只有“真实启动和退出记录”，尚未定义 native 操作超时后的收束和数据清理条件。当前 main 正常关闭要依次撤销目录授权、取消响应、等待 businessGate、导出 IO、配置 IO、repository、worker close、draftJournal、applicationMetadata，然后提交退出。安装测试应使用原 UI/菜单触发这条实际路径，保存完成后等待旧进程真正退出，再启动不同 PID 重读；app.close resolve 或 renderer 消失都不能单独证明 physical drain。

v2应固定有界启动、单操作、保存、优雅退出、强制收束 deadline，单阶段长任务仍每60秒以内报告进展；由外部 watchdog 记录本次启动的精确 PID/子进程身份。超时先保存截图/阶段/错误/已知任务，再请求正常退出并等待；若只能强制结束，记录该场景失败/未知并保留数据，不标“正常保存退出通过”。强杀不是实际 flush 证据。

最终 finally 必须覆盖 firstWindow/readiness 前的异常，释放本次模型 fixture/端口/注入 gate，确认所有本次进程退出后才考虑清理。成功标记要在退出确认之后；任何尚未 settle 的 write/未知任务/替换后的目录禁止 rm。测试数据和失败目录默认保留，清理仅限本次精确认领的 canonical 对象，不复制旧开发 smoke 中“passed 在退出前置 true、catch close 后直接 rm”的模式。监听器检查应区分应用自身 HTTP/DB listener 与测试 harness 自己的 debugger/loopback fixture；有模型 fixture 的该场景需另列 scope，不能拿它宣称纯离线零端口。

## v2 可直接固定的品牌与检查内容

`Seal` 真实组件在 `src/components/marketing/seal.tsx`，使用独立仓库现有 public/brand SVG。可锁定 `public/brand/seal-paper.svg`（SHA256 `fc89e3a8faead7b0578950f269d30ac4a07a4da153c1a14bef2a878c4f6afe22`）为完整图形派生输入，或明确选同母版 mark；不要画新标志、引用父仓库资源或使用设计截图。安装的 iconConverter 支持 SVG→1024栅格→ICNS/ICO；建议产物锁 hash/尺寸并检查 Dock/Finder/实际 exe 图标。buildResources 本身不自动进入运行包，运行 Logo 仍来自 out/brand。[v26 图标输入与派生](https://www.electron.build/v26/docs/features/icons-and-images/)

Next export 已使用本地 Monaco loader 与 editor.worker；PDF 字体从 `/fonts/noto-sans-sc/NotoSansSC-Regular.ttf.gz` fetch，字体和 provider 许可证均在 public。产物检查须基于真实 out 的资源引用与散列，打开 MarkdownEditor、编辑中文、导出含中文文档，确认本地 worker/font/brand 加载，不用只读取文件存在来代替页面验证。

## TDD / 有限验包建议

以下是待实现 oracle，不是本轮已运行结果：

| 编号 | 真正行为与失败条件 |
| --- | --- |
| PK01 | 缺专用 config、无明确 platform/arch/appId/output/asar=false 的正确断言先 RED；语法/工具未安装不当 RED。 |
| PK02 | 用 installed schema 验配置；mac arm64可执行，x64/Win只有配置状态，无法把本机 electronDist用于它们。 |
| PK03 | 实际 app 根五入口与所有迁移输入 hash 对照；遗漏任一入口/原 SQL 则失败。 |
| PK04 | 植入本次公开 canary 到 design/docs/evidence/test、map、环境/假数据目录及退役 entry；实际包不可出现，不能只测试 JSON 配置。 |
| PK05 | 自动 production/optional 闭包按真实版本清单比对；所有 module exports 的 realpath在包内，清空NODE_PATH、使用包外 cwd；dev-only包与父仓库引用拒绝。 |
| PK06 | Prisma compiler runtime/base64 与 PGlite资源实际加载；缺项在安装路径失败，禁止空模块回退。正常原schema/PG验证另协调资源窗口。 |
| PK07 | sharp本机目标二进制/libvips匹配并实际处理自建图片；错误架构或缺库不能只发警告后发布。 |
| PK08 | 图标源hash、派生尺寸/格式、Info.plist/actual exe资源，版本与真实app.getVersion一致；未签名/未公证记录。 |
| PK09 | 原样打包二进制、actualisPackaged、actualarch、三类数据路径完整隔离，testroot无效；未获安全隔离则not-run。 |
| PK10 | 无Next/devNode/外部DB进程、无应用HTTP/DB监听、静态资源均xuanxiang本地加载，页面无异常/外网请求。 |
| PK11 | 实际设置/空目录新作品/中文编辑/保存/优雅完整退出/新PID重开，以内容与文件计数验证持久化；native picker/IME/系统菜单逐项另证。 |
| PK12 | 初始化前异常、IO挂起、任务未停、owner撤销、关闭失败与总超时均有限收束；0误删本次外目录、0强制退出冒充正常通过。 |

本机 `.app` 的真实运行与 DMG 文件产出/挂载安装是不同结果；产出 DMG 不等于完成拖入安装与重开。x64、Windows NSIS安装/卸载与系统交互保持待对应平台验收。有效530正式用例由台账逐子结果记录，本轮合同审核对任何正式用例均不授 PASS。

## 本轮依据与限制

通过本机包 metadata 核实 electron-builder/app-builder-lib26.15.3、Electron44.6.0、Node v24.19.0、Next16.2.10、Prisma7.8.0、sharp0.34.5。只读调用了 builder FileMatcher；没有调用 collector（其会创建临时文件并执行 npm）、packager、图标转换器或二进制启动。官方网页用于配置背景，优先以当前 installed源码判定行为；例如官方 hook 文档的 `onNodeModuleFile:false` 排除说法与当前 copier 的 bool forceIncluded实现不完全一致，建议使用已验证负向 matcher并实际验包，不靠该 hook猜测白名单生效。

现有 src/generated 并非额外运行资源目录；封包不要将 generated TS、整个源码树或旧恢复组件带入。旧源码与历史证据保留在仓库不意味着可进入安装包。完成R01-R05及明确v2后，可做技术合同复核，再按TDD实现配置/验包；之后另交代码审核与真实平台验收。本轮没有实施完成或原生平台通过结论。

## v2复核记录

已独立读回同路径v2，SHA256 `83e9ca3e17d35c4a81fd103a53ca34c9f6c3ae4c44b118c11cc033921fb0233a`。五个当前真实入口、撤销两个旧入口、project与production/optional分开、显式map排除、运行资源许可证、next/prisma当前仍收集、sharp架构与有效530范围均已明确：R02的合同清单歧义已解决，R03入口歧义已解决。依赖闭包与禁止项真正收集结果继续留给实际产物TDD，不因文字更新而称测试GREEN。

v2将实际UI运行从无条件build中分开，明确 packaged 不使用 TEST_ROOT/user-data-dir 隔离，默认位置absent只作只读环境事实。本轮严格遵守不启动默认位置；后续fresh-only方案仍须在真实交互前落实，若不能满足则not-run。因此R01不阻止配置及静态.app验包阶段，不能据此授原生安装隔离PASS。

当前余项是R03独立output/原相对资源布局与Prisma实际runtime声明、R04明确identity=null/notarize=false/forceCodeSigning=false/publish never及本地发行预检、R05finite drain/cleanup。已送实施方作短段定稿；在这些可执行约束固定前，不把v2全文授为原生运行技术门通过。历史首版NEEDS_REVISION与本条有限复核均保留。

## v3最终有限复核

已重新独立读回v3全稿，SHA256 `9845a66a0d8f0f06b7e43eafd3280ddd4173c70e5ca3d441d55a212ce497dca1`。此读数对应本次技术结论。`package.json`、`scripts/build-desktop.mjs`、`desktop/main/index.ts` 的本轮只读散列仍与首轮核对相同；未通过改生产代码消解审核问题。

| 原问题 | v3处理与当前判断 |
| --- | --- |
| R01 | 固定本轮仅构建和静态验包，禁止启动默认用户位置；实际UI与fresh-only/独立账号条件留后续落实。配置/静态阶段已解决；真实路径隔离仍未验收。 |
| R02 | 明确项目五入口/out/migrations/license白名单、独立production+optional闭包、显式依赖map排除与实际产物验证，保留真实next/prisma及WASM/compiler资源。合同已解决；实际闭包由TDD证明。 |
| R03 | 新增独立release输出、asar=false的resources/app原相对布局、不重写worker/资源/migration路径。结合v2五入口，合同已解决。 |
| R04 | 固定mac identity=null、notarize=false、forceCodeSigning=false、publish=never，wrapper在builder前验证本地发行版本/OS/架构与sharp；预检失败直接结束，不依赖会fallback的hook。macarm64本轮合同已解决；x64/Windows只有配置，待对应环境。 |
| R05 | 固定实际交互阶段有限watchdog、PID归属/实际退出、原正常停止/flush/关闭，异常/强制终止不能计正常通过，未知数据及退出前资源保留。本轮静态与后续native边界已解决。 |

**本轮没有仍须先修的技术合同阻断项**，可以按TDD实现配置/wrapper与实际macarm64 `.app`，随后提交代码及产物独立审核。v3中前面的实际二进制启动/设置/创作/保存/重开段落是后续验收目标，最后的“本轮实施仅配置、真实.app构建、静态验包”明确限定当前执行，不能将后续段落自动变为本轮启动授权。

实现前应将以下已审条款落实为可失败的检查；它们尚无生产实现或GREEN结论：

- 本机打包必须显式指定mac arm64，预检Electron44.6.0/二进制架构/当前sharp与libvips真实资源，传已验证electronDist；x64/Windows配置不能继承这个本机路径。Windows未签名配置采用安装类型支持的signExecutable=false，保持资源编辑；未执行Windows构建不检查其产物存在。
- installed配置schema与actualmatcher的TDD只证明规则；随后对实际app根枚举五入口、全部SQL/lock、out资源、许可证、node_modules闭包及所有禁止项，验证canonical解析落包内。不能只跑Node require.resolve后声称actualElectron运行；PK06的实际PG/编译器运行与PK09-PK12原生步骤本轮暂不执行。
- 依赖map/项目map和退役entry要真实缺席；Next/Prisma当前是生产图的一部分，不在该配置阶段无证据裁剪。字体/provider许可应保持明确的runtime-licenses包内路径。Node运行Prisma generated已bundled且动态导入runtime，不能为了符合第10节笼统“生成文件”措辞额外捆src/generated。
- 如果生成归档或DMG，须逐产物记录架构/输入/清单/散列/未签名状态；DMG产出与挂载安装是独立结果，后者不属于本轮。任何build/preflight/验包失败均保留其有限证据，不因为暂未启动而报安装可用。

此有限通过没有扩大真实电脑使用授权、没有改变本轮默认根禁运行约束，也没有批准未签名产物的发布。有效530正式用例、本机原生安装UI、macx64与Windows均继续按原台账保留not-run/待对应证据，不从本技术合同提升状态。

## 补充测试合同与PK08修订

已读 `docs/evidence/implementation-39/packaging-static-test-cases.md` 首稿，SHA256 `9e280ba1277433cc938cf53fddb6bb3b4ef6e2f09fd6165566d49d03e95b8488`。PK01-PK10清楚限定为构建/资源/依赖子结果，PK11-PK12本轮not-run，允许对本次临时坏包副本作可逆删除攻击；这种范围与v3一致。编号与本报告早期oracle建议是实施方的细化映射，不宣称完全同义。

**R06 · P2（测试协议，须在PK08前修正）：PGlite不接受SQLite式`:memory:`内存目录语义。** 当前安装PGlite0.5.8的dist/index.js/cjs将空dataDir或`memory://`前缀判为memoryfs，其余目录字符串判为nodefs；`pglite-BdeXTuy6.d.ts`也明确内存使用`memory://`。因此首稿“PGlite只在`:memory:`内操作”实际会选择磁盘FS，不能用于证明零数据目录写入。本轮只读核了该真实分支，没有创建引擎或数据库；不能称该问题已有执行RED。

修订要求是明确`memory://`（或无dataDir）、子进程由本次测试创建并持有的临时cwd、去除NODE_PATH等外部解析旁路、createRequire锚定实际包内路径并核所有external依赖realpath。Node/Electron builtin（含electron）按内建能力分类，不能把开发electron npm包误作为需要捆绑的运行依赖。PGlite查询与sharp图片处理可作为包内资源运行检查，不启动Electron、不调用原main、不打开原schema/业务根；它们已经超出“纯静态读文件”，结果应单列为隔离Node资源检查。

PK08必须在finally中await实际PGlite.close并检查closed，子进程硬watchdog覆盖初始化/查询/close挂起；强制结束时该项失败并保留包/失败记录，不能将强杀算实际close成功。资源启动/关闭也要有限而非仅给顶层测试timeout。库选择memoryfs不保证所有依赖永远无磁盘行为，因此仍用临时cwd收容未知相对写入，失败不自动删除未确认退出对象。R06不阻止配置与PK01-PK07先行；首稿测试合同在其修订前不授整体通过。

已读公开 `upstream/sharp-libvips-v1.2.4-THIRD-PARTY-NOTICES.md`，SHA256 `3f416978dd2448ddab0d413d333c45fb208acdc066c280b95ebcb2f8b9f34ab9`。实际libvips metadata声明LGPL-3.0-or-later且包中没有单独LICENSE文件，补同版本upstream notices并记录versions/source链可作为构建静态provenance；这份库/许可列表不是所有许可证全文，也不是整体分发合规审核。当前阶段没有发布授权，不从这个文件授合规或发行PASS；最终包清单应保留来源URL、版本、内容hash与真实包内位置，避免报告把“存在一份notices”扩大成完整义务已解决。

### 测试合同修正后结论

已独立读回12项测试合同修正版，SHA256 `e2c579c6635ee1906811c82b9e4fee2ea618ad19a7fe9144e2ef18859826d831`。PK08及末段均改为PGlite `memory://`，固定自建临时cwd、finally实际close/closed、外部watchdog与实际退出，关闭失败/硬终止记失败并保留未知数据；正常完成才清理自有目录。R06已在合同层解决，首次错误语义与来源在上文保留，没有把未执行的库问题编造成RED/GREEN。

补充测试方案结论为 **PASS_LIMITED_PACKAGING_TEST_CONTRACT**。可与v3技术方案一起开始配置/wrapper、macarm64实际app/归档/DMG构建以及PK01-PK10有限检查。PK08包含已明确授权的隔离Node包内依赖资源运行检查（memoryfs查询/真实sharp处理）；这是该计划的单独子结果，不是纯字节检查，也不是Electron、原业务schema、普通保存可靠性或原生安装验收。原报告建议PK06中的完整数据库运行测试与新PK08资源检查不可混称。PK11/PK12明确本轮not-run，独立账号/fresh-only真实交互前置仍须后续落实。

**技术方案与补充测试合同当前均无阻断项。** 这两个PASS只评价计划，尚无本轮配置实现、实际产物、代码审核、包内运行结果或正式平台用例通过。本审核仍只改此文档，未启动任何引擎、build或Electron。
