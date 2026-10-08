# 119 · macOS首菜单本地化代码审核

2026-10-08，更新于实际package-01失败及MB119-N05修复之后。结论：**PASS_LIMITED**。补建必需语言目录后的最终本地化方案当前无限定源码范围内的遗留阻断，可以重新打包并进行后续macOS原生验证。原raw `CFBundleName=玄印`方案被本审核的真实builder/FS反例否定，已改为raw运行名称保持玄印写作、localized名称为玄印；不能把旧方案原作者测试的更换称为原oracle修复。

本审核没有启动App/Electron/PG、读取HOME实际数据或改生产源码。只新增独立 `tests/unit/macos-menu-bundle-119-review.test.ts`、四份日志与本报告；Node/FS/`plutil`均作用隔离fixture，finally已清理。测试中的App/Helper文件是无执行权限的普通文本名称fixture，未运行。审核者未执行安装包构建；作者package-01失败及旧产物被替换的事实保留，不授实际构建、真实首菜单、签名、公证、Windows或正式530项PASS。

## 最终范围与指纹

| 文件 | SHA256 |
| --- | --- |
| `electron-builder.config.cjs` | `021757401466a4252abb8be95881b11967893f4ed825ddad6e0648527c33993f` |
| `scripts/macos-menu-localization.mjs` | `737a414bdce09ec37558d0fd2ffe5eb5ca1fc639a8e5cb4de63dc807dcdd8c6f` |
| `scripts/package-desktop.mjs` | `8d81876526ae457794e4ae7a640d0771fc070089d8f05b09e9107fd53679b3bd` |
| `scripts/inspect-packaged-app.mjs` | `bd55d136be1bf7c9a987884784f8ff3f6c37950afe18c0363bbe143098037ec8` |
| `tests/unit/macos-menu-bundle-119-review.test.ts` | `2fcd782746215f91f7bd2a1d967a9aefb802bc45e940a401ae3336ffa3ded927` |
| 作者 `tests/unit/macos-menu-bundle.test.ts` | `9ff55fdbe93cbe5075ffc8d0bb32f9f76de36e1a29d9e6a1ee219904c9eeb02f` |
| `implementation-43/menu-display-contract.md` | `1fb1be8728350164fd0c4ed1fa8569a4d18d77de420eb7580f2f2d1692f12045` |

实际安装版本为electron-builder/app-builder-lib 26.15.3、Electron44.6.0。builder配置最终没有 `mac.extendInfo` 的short-name覆盖，productName、App文件名、主可执行名、Helper命名、签名/公证/发布开关与原白名单继续沿用。新逻辑只在macOS打包输出中的原生语言目录安装一个metadata键，未改main/worker、UI、安全权限或用户数据入口。Windows分支不执行该安装。

## R01真实反例与修复

原作者实际 `MacPackager.applyCommonInfo` 测试验证了rawName覆盖的写入顺序，却没有覆盖完整 `createMacApp` 后续Helper命名链。安装源码先按productName写 `CFBundleName`/DisplayName，再按extendInfo覆盖；但 `electronMac.createMacApp`仍按 `appInfo.sanitizedProductName` 生成并rename Helpers。因此rawName变玄印、productName保持玄印写作时，两者失配。

本审核执行实际installed `createMacApp` +实际 `applyCommonInfo`，只控制AppInfo、icon/resource端口与隔离Electron文件结构。主exe、DisplayName、版本及bundleId先通过，随后 MB119-R01 的Helper查找断言真实失败：候选 `Electron Helper.app` 与 `玄印 Helper.app` 均不存在，实际为 `玄印写作 Helper*.app`。`implementation-43/review119-01-helper-lookup-red.tap` **0/1**，0.82秒，exit1，SHA `d7b743be1b5afcc491eda387986f92f581ff2fffde02a77c27311b819e7b8d6b`。

运行时风险依据精确Electron44.6.0源码：`GetApplicationName()`读取非localized `infoDictionary` 的CFBundleName；`OverrideChildProcessPath()`先找Electron品牌Helper，再按该名字找，缺失时fatal。此处是源码与实际builder文件输出相互支持的阻断，未启动App复现fatal。见[名字读取源码](https://raw.githubusercontent.com/electron/electron/v44.6.0/shell/common/application_info_mac.mm)、[Helper查找源码](https://raw.githubusercontent.com/electron/electron/v44.6.0/shell/app/electron_main_delegate_mac.mm)。

最终方案恢复rawName为玄印写作，运行时与Helper输出继续相符；原 MB119-R01 的实际调用和Helper oracle未改，复跑GREEN。作者否定原rawName-only方案并保留其03真实RED及01/02 fixture错误历史；新作者测试分别验证raw运行名称与localized资源层，未冒称旧错误期望被修复。

## 本地化与打包链已核

Apple将CFBundleName定义为菜单/关于使用的短名、CFBundleDisplayName作为显示名，并说明通过语言目录内的InfoPlist.strings本地化属性值。本方案分离localized显示与非localized运行时身份，依据[Apple QA1544](https://developer.apple.com/library/archive/qa/qa1544/_index.html)与[属性列表本地化说明](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/AboutInformationPropertyListFiles.html)；能否在本机实际首菜单显示玄印仍待CUA，不由文档或文件存在推定。

`installMacMenuLocalization()`先核实际主App Resources为canonical/nonlink目录，仅补建en.lproj、zh_CN.lproj两个必需目录，mkdir仅EEXIST可继续，随后原枚举仍拒绝非目录/链接与非法目录名。每个既有locale用wx新建UTF8 `InfoPlist.strings`，只含CFBundleName为玄印。已有未知文件不覆盖，partial构建失败也不继续出包。verify仍要求en和zh_CN存在，不自行补建；逐locale核常规nonlink文件、nlink1、实际路径、精确尺寸及原UTF8字节，因此多余键、其它显示名或内容替换不能通过。

macOS `afterPack`在实际App路径安装，再调用静态inspector及原包依赖probe，完成之后才进入归档产物阶段。inspector强核raw CFBundleName、DisplayName、Executable均为玄印写作，版本/id保持原契约，并要求nativeMenu资源验证；真实结果与文件SHA进入后续manifest。其它project资源、prod依赖、架构和许可证校验继续原逻辑，不能因为localized菜单验证而跳过。

这不是运行时修改App，也未复制设计稿/测试内容进产品。locale文件是构建期原生metadata。模块的 `runtimeName`结果是约定值，其真实性还由inspector对实际raw plist检查，不能单独将返回DTO当真实App身份。

## 独立有限验证

`review119-02-helper-locales-negative.tap` **13/13**、0skip/cancel、exit0，1.79秒，SHA `cd7269efd2781d6d7e968ddfa68795e13b601129c58d3a873154b4ab1fe6a87d`。

- MB119-R01：原完整builder Helper反例转绿，generic/Renderer/GPU/Plugin实际文件存在并保持版本；主App/exe/display/id/版本断言保留。
- MB119-N02：实际安装覆盖3个既有locale，逐文件核独立预期字节；额外DisplayName键与缺失文件均拒绝。
- MB119-N03：locale目录link、有效内容的leaf link均拒绝；已有metadata wx拒覆，原sentinel/链接目标保持。
- MB119-N04：执行实际inspector和系统plutil读取私有plist，错误rawName、DisplayName、Executable或版本在资源probe前拒绝；没有启动包或PG。
- 同轮原作者本地化测试、4条command-menu、4条packaging-config通过，包含实际installed schema/matcher与本地runtime版本/架构只读预检。没有构建安装包或执行资源PGlite probe。

本次Node命令：`node --import tsx --test --test-concurrency=1 --test-timeout=10000 tests/unit/macos-menu-bundle-119-review.test.ts tests/unit/macos-menu-bundle.test.ts tests/unit/command-menu.test.ts tests/unit/packaging-config.test.ts`。独立4条每项另设5秒timeout；fixture为私有tmp，无作者数据。

本报告没有重跑全仓types，作者43类型结果单独归属。未重新验证旧39/42全部资源或任何运行平台结果；相关有限检查通过后未扩大业务测试。

## package-01发现、N05真实RED与原oracle复验

前一版本119报告已由主代理保存为 `implementation-43/review119-prior-to-package-01.md`，本审核读回其SHA与更新前报告均为 `c71d3372274a4c0a56dabcf98c3b7da9b3cb24539d50be9980dfcb79bbfeb349`。不回写该历史报告、原Helper RED或原13项成绩。

作者随后执行实际package-01，afterPack因缺少必需locale拒绝；本审核只读 `implementation-43/package-01.log` 的实际错误，不称亲自构建。作者检查发现本机Electron原53个空主Resources语言目录被builder复制流程省略，输出只保留app/default_app.asar/icon等资源；此前“必须有原语言目录”的producer假设不能满足这个实际输出。尚未启动App。

新增MB119-N05从无语言目录的隔离Electron结构执行实际installed `createMacApp`，明确输出为0个.lproj，再要求install成功提供两个必需locale并保留主raw名称和sentinel。改生产前实际执行 `review119-03-no-locales-red.tap` **0/1**，0.90秒，exit1，错误为 `Missing required native locale directories`，SHA `2c20f69427eb3513acc8ed7425f86255a2cf062326fed351d72f379a0a771d33`。它验证实际createMacApp输出与安装边界，未伪称独立执行了整个builder空目录复制流程。

作者仅加canonical `nativeResources`前置及两项mkdir，再复用原目录/wx/verify逻辑。新增N05原成功断言未改；原13个oracle未改。独立 `review119-04-no-locales-postfix-related.tap` **14/14**、0skip/cancel、exit0，1.96秒，SHA `adc886854f7b6bfa195459eae98e827332a950ac2232b7506e6d5da4fd4499ed`。包括N05转绿、原Helper链、原missing/extra-key/link/EEXIST负测及相关schema/matcher/菜单检查。当前独立5项每项5秒timeout；总命令与前轮相同。

本更新只授增量代码及隔离验证，不授新的实际package成功。package-01已替换工作目录中的旧42 `.app`；主代理确认无App被启动。旧42冻结和115/117运行pin此时不能认证当前路径，不能再按旧SHA启动这个失败输出。必须重建、验包并冻结新的实际产物，再给对应harness pin授权。

## 交付边界

代码PASS允许重新打包，不能将现有42 App视为已含新metadata；新App、DMG/ZIP及manifest需新的实际SHA与冻结，115/117 harness旧pin不自动适用于43。真实启动后须核包路径/版本/PID与正常退出，再用CUA读取首菜单及独立关于窗口；文件内写有玄印不等于OS已显示玄印。Helper能被builder命名与本次FS oracle找到，也不等于本审核已执行Renderer/GPU健康验收。

原真实OS失败和独立RED保持历史。本119仅授最终三scripts及配置的有限代码/隔离验证结果，不授macOS菜单修复已成功、Windows、收费服务或完整正式验收PASS。
