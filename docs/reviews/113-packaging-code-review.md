# 113 · 独立安装包代码审核

结论：`PASS_LIMITED_PACKAGING_CODE_AND_RESOURCES_ONLY`。本轮发现的必需资源基线、导出目录数据库收集及 Windows 资源编辑配置问题已经修复，原独立 oracle 复验通过。当前限定源码审核没有剩余阻断。

独立运行配置及实际 `.app` 资源组 11/11 GREEN（19.51 秒），随后 Windows 窄配置修复后的纯检查 8/8 GREEN（3.58 秒），最终全仓 types exit 0、空输出。两组有 7 项重叠，不相加成 19 个独立用例。最终 14 个打包源码/配置/测试输入前后 SHA-256 与字节长度全部一致，changed 0。

本轮没有编辑生产或打包实现，只新增独立测试与审核证据；没有启动 Electron、默认用户数据位置、Windows 可执行程序、模型或供应商请求。本人此前实现的两个 service 文件不在本次独审范围。正式 530 条验收仍未执行，不能据本报告授安装、原生 UI、macOS x64 或 Windows 通过。

## 范围与实际实现

审核依据为 `docs/evidence/implementation-39/packaging-contract-draft.md` v3 和 `packaging-static-test-cases.md`。实现范围：

- `electron-builder.config.cjs`；`scripts/package-desktop.mjs`、`packaging-runtime.mjs`、`prepare-package-resources.mjs`、`inspect-packaged-app.mjs`、`packaged-resource-probe.cjs`。
- `scripts/assets/sharp-libvips-v1.2.4-THIRD-PARTY-NOTICES.md`，package 脚本、`.gitignore`、第三方声明增量。
- 作者的配置/真实资源检查，以及新增 `tests/packaging/packaging-113-review.test.ts`。新增 archive 测试只读审查，未把作者的 ZIP 成绩记为本审核执行。

项目 files 为五个实际入口、Next out、原迁移、许可证及运行许可的正向规则；撤销的恢复入口、项目源码/文档/设计/测试、map、环境文件和已知数据库/受管目录排除。生产依赖通过 builder 的独立收集闭包进入包，明确仍含 Next/Prisma；没有宣称它们已裁剪。`asar=false` 保留既有路径读取方式，没有修改业务资源路径或目录保护。

实际 installed builder 26.15.3 schema 与 matcher 校验通过。本机 preflight 在 builder 调用前校验 Electron 锁定版本、平台/架构、Sharp 与 libvips 二进制。脚本使用明确本地 `electronDist` 字符串，固定 `publish='never'`；mac 配置禁止签名、公证，Windows 保留资源编辑且禁止签名。本审核读了 installed `winPackager.js` 与 `winOptions.d.ts` 的真实分支，不以网上旧版本配置推断新选项行为。

`afterPack` 接入实际资源/metadata/架构/依赖检查，在归档目标前完成并输出 manifest；缺资源或包外依赖不靠空模块回退。包内依赖 probe 用安装包自己的 require 路径，module hook 拒绝包外解析；实际 Sharp 转码、Prisma 编译器资源头读取及 `memory://` PGlite 查询/关闭已独立执行。probe 有外部硬 watchdog，失败保留自身临时目录；正常返回明确 `pgliteClosed=true`、子进程 exit 0。资源检查是 Node 工具检查，不能代替 Electron 或真实业务数据库运行。

资源准备复用原温玉 SVG，生成并实际解码 ICNS/ICO，各尺寸符合本轮测试。运行许可拷贝字节与来源一致；sharp-libvips notice 与证据目录保存的上游副本逐字一致。本报告没有额外授全部第三方依赖发行许可审核完成。

## 独立发现、修复与复验

### PK113-R01：输入与包同时漏资源时，原检查误通过

原 `verifyProjectResources` 只枚举当前输入目录生成 expected。独立隔离拷贝先通过完整资源 baseline，再同时删除 source 与 packaged 中的 `out/index.html` 或实际 Noto Sans SC 字体；两次都返回成功，产生真正 `Missing expected rejection`。

Root 增加固定必需首页、字体、品牌及 provenance 基线，并要求存在迁移 SQL 输入。原两项 oracle 未改，修复后 GREEN。该结果检查缺失边界，不等于解析每一种运行资源或执行完整 UI。

### PK113-R02：导出目录内的数据库文件被收集

实际 installed builder matcher 原本允许 `out/author.sqlite3`，独立断言确实 RED；没有复制真实作者数据库。Root 增加 db/sqlite、WAL/SHM、PG_VERSION 及受管目录排除，并在实际包树检查中同样拒绝；路径段正则明确包含点开头目录。原样例的正常首页/字体仍保留，三个数据库路径均排除，oracle GREEN。

### PK113-R03：禁签名选项也跳过了 Windows 产品资源编辑

原 `win.signAndEditExecutable=false` 令 installed `WinPackager.signApp` 直接返回，图标及版本资源编辑 dispatch 为零。独立测试调用 installed 实际方法和真实隔离目录，捕获 native PE 编辑端口，日志及断言确认该分支。

Root 改为 `signAndEditExecutable=true`、`signExecutable=false`。原 oracle 复验观察到唯一产品 exe 的编辑 dispatch，并保持签名禁止。实际 PE 编辑端口为记录 double，哨兵不是可执行 PE；本测试没有运行或生成真实 Windows 包，不能授 Windows 验收通过。

打包 wrapper 最初缺少归档前验包的接线，也已由 root 加入 `afterPack`；原无 hook 的目录构建日志保持历史身份。当前独审没有把之前 DMG/ZIP 自动标为最新严格规则已构建。

## 原始记录

证据目录为 `docs/evidence/implementation-39/`：

| 文件 | 分类与结果 |
| --- | --- |
| `review113-01-config.tap` | 独立原配置组 4/4 GREEN |
| `review113-02-required-resources-red.tap` | R02 为实际 matcher RED；前两项因独立夹具未按 builder 排除 map 而在 baseline 失败，属于夹具问题 |
| `review113-03-required-resources-attempt.tap` | 校准 fixture 后，R01 两项完整 baseline GREEN 前置后真 RED，R02 真 RED；全部保留 |
| `review113-04-inputs-before.json`、`review113-07-inputs-after.json` | 首次修复后 13 个输入前后 unchanged；上游 notice copy byte equal |
| `review113-05-related-postfix.tap` | 原三 RED、作者配置四项及实际 `.app` 资源四项 11/11 GREEN，只有一组 memory PG |
| `review113-06-fulltypes.txt` | 当时全仓 types exit 0、空输出 |
| `review113-08-windows-dispatch-attempt.tap` | 直接加载 builder 内部模块导致初始化循环，未到 dispatch；是保留的夹具失败 |
| `review113-09-windows-dispatch-red.tap` | 改用官方包入口后，实际 installed dispatch 真 RED；资源编辑被跳过 |
| `review113-10-final-inputs-before.json`、`review113-13-final-inputs-after.json` | 最终 14 项 hash/bytes 全一致，changed 0 |
| `review113-11-final-pure.tap` | 窄修 Windows 后，原四独立 oracle 与配置四项 8/8 GREEN；没有重复 PG |
| `review113-12-final-types.txt` | 最终全仓 types exit 0、空输出 |
| `review113-14-finite-summary.json` | 有限结论、实际执行与范围清单 |
| `review113-15-final-artifact-hashes.json` | 最新严格规则实际 manifest、DMG/ZIP/blockmap 散列；五个关键 `.app` 文件与 manifest 一致、14 个审核输入未变 |
| `review113-16-frozen-v1-readback.json` | 独立读回 root 冻结 v1：17 输入与 5 产物全部匹配，日志确认 afterPack 先于归档；旧报告散列差异单列 |

所有原始失败日志及独立失败拷贝保留。夹具修正只恢复正常 builder map 排除和正确的 installed 模块初始化，不降低资源缺失、数据库排除、产品编辑 dispatch 的原断言。

## 交付边界

Root 的旧 `.app`/DMG/ZIP 生成及 archive Unicode 观察问题有其自己的日志，不被覆盖。Root 随后以最终严格规则执行 `package-final-01.log`，真实生成 DMG/ZIP，`afterPack` 完成后才进入两个归档目标。作者的最终 14/14、全 types 与 `dmg-verify-final-01.log` 的 VALID 属于作者执行记录，本报告没有把它们并入独立测试计数。

本审核只读重算最新实际文件散列，结果为：

| 实际文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `release/package-static-darwin-arm64.json` | 6,071,636 | `f6e10db57b6ec1d3786d644ea119896a71003bdb5251e4697329b770b4ee118c` |
| `release/Xuanxiangxiezuo-Desktop-0.1.0-mac-arm64.dmg` | 335,447,918 | `c6ceaec5ccdf19f013030b5e8bb41d21687c954a411e86b06cdcacb21f416cb4` |
| `release/Xuanxiangxiezuo-Desktop-0.1.0-mac-arm64.zip` | 350,088,599 | `86c9c338046e0d1c494498cf907c5b63b2edabd5ab8d2673b05700f7d19cbb17` |

最新 manifest 记录 314 项项目资源、27,009 个包文件、21 个入口外部模块、7 个二进制架构检查及 44 个 probe 模块；依赖结果 `queryResult=42`、`pgliteClosed=true`、`exitCode=0`、`forcedTermination=false`。本审核重算 Info.plist、主可执行文件、main/service bundle 和 provenance 的散列，五项均与该 manifest 一致，14 个审核源码/测试输入仍全部未变。blockmap 散列也保存在 15 号证据。该只读核对不等于本审核重新执行 builder、PG、hdiutil 或 App。

随后独立读回 `packaging-frozen-v1.json`（文件 SHA-256 `677074c4702da145d5155ef808487073ba5a498c1bc39467514587e83f93e801`）：17 个输入与 5 个最终产物逐项重算字节/散列，均无不匹配；其 662 业务源基线文件引用散列也匹配，这里没有重复执行全部 662 个源检查。实际构建日志明确 afterPack 在 ZIP/DMG 目标前完成、最终 packaged 在两个目标后，作者最终 TAP 为 14/14、DMG 日志为 VALID。

v1 的 evidence 中仅本 113 报告散列与当前文档不同，因为按 root 授权补入了最终 artifact、环境变化和冻结读回记录；原 v1 保留旧报告 SHA，未被修改。root 后续 v2 将引用更新后的最终报告。这是明确的审核文档增量，不伪称 v1 的全部 evidence 字节未变。

重要后续环境边界：root 的 `default-paths-readonly-02.json` 复查已发现 `~/.xuanxiang` 和 appData 下旧 bootstrap 位置均存在，产生者未知。本审核没有读取这些目录内容、启动现有应用或写入/清理它们。此前“默认位置不存在”的读数已不能作为后续 fresh-only 场景依据；实际 packaged UI 验证需要独立测试账号或另行明确的数据环境。此处保持 static-only，不授挂载、拖入安装、App 运行或正式系统用例通过。
