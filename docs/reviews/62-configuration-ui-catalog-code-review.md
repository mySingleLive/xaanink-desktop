# 62 · 配置转移界面与可信命令目录独立审核

日期：2026-10-08。审核者：`/root/ui_revision_review`；实现由主代理编写，审核者只新增行为测试/证据/报告，不改实现。

## 当前结论与范围

**限定范围通过（PASS），本轮三个实际问题均已关闭**。最终新增独立18个顶层行为测试（12个实际React/BaseUI UI、6个目录/构建测试）全部通过，0跳过/取消；不把修复过程的重复运行累加，不将作者或主代理的单独结果代替独立复验。最终全项目类型检查退出0、空诊断。531正式用例保持既有not-run状态。

范围：`ConfigurationTransfer.tsx`、`SettingsDialog.tsx` 新增通用导入/导出两行；`generate-command-catalogs.mjs`、`verify-command-catalogs.mjs`、`command-catalog-sources.mjs`、`trusted-command-catalogs.ts`、随包 generated JSON，以及 `build-desktop.mjs` 的 verify-before-build 调用。原 ModelChoiceSelect/ProviderLogo/store/transfer core 用于真实集成验证，不借此次审核重新批准全部业务。主进程文件选择/保存/CAS/owner 生命周期属于61；其他设置功能、整个Monaco动作执行、双平台系统行为及531正式用例不在本轮PASS范围。

## 独立发现

| 编号 | 实际行为 | 状态 |
| --- | --- | --- |
| CFG62-U06 | 真实设置父子框在apply pending时外点关闭并cancel；迟到apply Promise在mounted/current guard之前receiveDesktopState，仍把当前确认revision3覆盖为4。 | 主代理在await后、receive前检查mounted/current session。原独立RED不改断言，复验通过；正常已提交state广播仍走全局通道。 |
| CFG62-C03 | 保持真实源hash全部匹配，将隔离副本的win32 commands设为[]而resolved=true，实际verifyCommandCatalogs仍接受。构建门禁不能确认目录完整。 | 主代理补两平台resolved、200..10000非空/唯一ID及字段形状，增加commands摘要；原RED断言不改，最终复验通过。 |
| CFG62-C04 | 保持真实源hash全部匹配，将隔离产物monacoVersion改0.55.0，实际verifier仍接受，未核声明版本与已安装0.56.0一致。 | 主代理核声明版本等于安装包版本；原RED断言不改，最终复验通过。 |

目录两项是构建产物完整性/版本门禁问题；不是声称应用可防拥有本机文件修改权的攻击者，也不是便携用户JSON所定义的命令权限。

## 已独立执行的真实交互

`tests/browser/configuration-transfer-ui-review.test.ts` 在隔离Chromium挂载当前实际SettingsDialog、ConfigurationTransfer、React19、安装BaseUI Dialog/Checkbox/Combobox及实际Zustand确认store。只替代原生配置IPC和通知，其他设置子页占位以限定范围。Node侧使用真实prepare/resolve配置核心生成plan及验证提交，避免把Node文件系统模块捆入浏览器。所有网络阻止，样式使用当前编译Web CSS与当前desktop.css。

12个顶层测试通过：原通用行实际按钮；预览不写确认store；逐项勾选并取消笔名/快捷键/模型项；真实core冲突拒绝、保留原选择/确认状态、用户明确修正再提交；模型默认最初不自动勾选，必须选择本机UUID或null；文本/图像分开，仅enabled对应kind，GPT/Kimi本地model logo src及自定义cube映射正确，payload不回传plan；空选择禁应用，清空默认不补位/不建模型；忙态禁草稿与重复激活，Escape仍取消owner；取消、Escape、实际外点关闭，前两者实际返焦导入按钮；离开通用时preview/export owner取消，晚到结果不重开/成功toast；外点取消apply晚到也不更新store；导出失败可见、显式重试成功。640×560真实popup在视口内，footer三个按钮可达，Combobox搜索/Escape只关菜单返焦触发器。

图标测试核实际DOM的已批准本地路径与通用cube，不冒称本次重新完成全部品牌资产视觉验收。导出/文件picker是可控IPC，不访问系统文件选择器、用户文件或系统剪贴板。store结果验证不是UI字体/缩放实际副作用证明；主代理原生证据另列归属。

## 目录与构建验证

独立测试执行原generator源码，只将最终writeFile替换为内存捕获。仍使用原esbuild装配、原initializeMonacoCommandCatalog、实际已安装Monaco0.56.0、共同registry及原monaco-setup。两个隔离Chromium context的navigator/user-agent分别为平台注册环境；生成完整JSON与随包JSON逐字段相等，包含ID、defaults、when、weight、args、alias对应ID与源指纹；darwin416/win32400，ID唯一。actual trustedCommandCatalogs注入与生成platforms相等。

模拟平台用于构建期注册枚举，**不是Windows运行、原生按键或两平台OS验收**。枚举不创建用户正文editor/model，不发CDN请求。

实际verifier在真实隔离目录读每份源副本及generated JSON，匹配版本接受，一份源变更拒绝。实际build-desktop脚本通过受控routes/build写入边界执行，保留真实verifier；stale校验失败时build调用计数0，不改主代理dist或routes。空目录/声明版本错误的原RED已转GREEN。同数量命令内容变更但旧摘要不变会拒绝；即使重新计算摘要，重复ID、非boolean contexts及非法scope仍拒绝。commands摘要用于发现损坏，不是用户或修改安装文件者的认证。

## 证据与限制

`docs/evidence/implementation-09/`：

- `review62-ui-independent-red.tap`：9项8通过1实际失败，仅U06。
- `review62-ui-final-green.tap`：最终12/12通过，0跳过/取消，退出0；既有9项与重复复跑不另计。
- `review62-catalog-actual-generation.tap`：原生成器完整比对与stale源校验首次2/2通过，不伪造RED。
- `review62-catalog-boundary-red.tap`：4项2通过2实际失败，仅C03/C04。
- `review62-build-pipeline-first-run.tap`：C05实际脚本门禁1/1首次通过，不另算重复目录测试。
- `review62-catalog-final-green.tap`：最终6/6通过，0跳过/取消，退出0；包含C05，不额外累计其首次记录。
- `review62-final-typecheck-green.txt`：最终全项目tsc退出0，空诊断。早次空诊断与 `review62-final-typecheck.txt` 的范围外service works未赋值诊断均保留；该在途代码由其作者修复，审核者未修改。
- `review62-independent-summary.json`：最终受审版本、证据与独立测试指纹；自身不参与指纹。

初始UI日志含测试语法、错误把Node-only core放浏览器、TEXT引用错误用于IMAGE、BaseUI Trigger实际role=combobox的定位错误；后一次U03失败是旧定位要求连续“快捷键冲突”而实际错误文字含其他字符。目录初次捕获插件产生自引入cycle。均保留为夹具/工具失败，不计产品缺陷。没有为这些问题改生产源码。

主代理另跑 `native-configuration.json` 三组实际macOS arm64开发Electron：真实磁盘便携导出排除密钥/目录；预览无写入、选中主题字号立即生效而未选笔名不改；取消预览/坏JSON保留确认配置并显示错误。本审核只读结果，未独立操作Electron；系统picker返回受控、无OS文件选择器或Windows验收。531正式用例不改状态。
