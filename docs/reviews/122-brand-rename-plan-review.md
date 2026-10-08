# 玄印写作改名技术方案独立审核

2026-10-08。审核对象：`docs/reviews/121-brand-rename-plan.md`。用户已确认「兼容旧版数据，新建数据使用新名称」。仅审核并写入本文；未修改实现、测试，未读取真实用户作品或密钥。

用户最新命名为「玄印写作」、简称「玄印」、英文名「XaanInk」；本次中文名称更正不改变下述数据兼容方案，技术方案仍通过。

## 结论

**通过，可以进入独立测试用例审核与 TDD。** 已复读更新后的方案，确认其已补入系统密钥身份约束。权威 marker 决定命名家族、旧 bootstrap 保持原实例锁、旧控制文件不改名、新作品采用新家族、双 marker/混合控制记录拒绝，这些原则可以满足用户答复。下面的接口和不变量作为实施与测试审查依据；通过技术方案不等于平台验证通过。方案不应以全仓库替换持久化 token 的方式实现。

已纳入方案的 P1 风险：macOS `safeStorage` 加密身份。改名前基线在 `desktop/main/index.ts` 的 Electron 初始化前调用旧品牌的 `app.setName()`，`desktop/main/model-repository.ts:53` 从旧 `state.json` 取得密文并通过 `safeStorage.decryptString()` 解密。当前安装的 Electron 为 `44.6.0`（命令：`node -p 'require("electron/package.json").version'`）。[该版本官方源码](https://raw.githubusercontent.com/electron/electron/v44.6.0/shell/browser/electron_browser_main_parts.cc) 的 `PostCreateMainMessageLoop()` 在 macOS 将 Keychain service 设置为 `app_name + " Safe Storage"`、account 设置为 `app_name`。因此直接修改初始化前的名称会改变密钥命名空间；保留数据目录并不能证明旧 Key 可用。

建议在检测到旧 bootstrap/root 时，保留 Electron 初始化阶段旧加密身份，待其完成密钥身份初始化后再设置新显示名；新安装初始化阶段使用新身份。该策略必须用隔离假 Key 的真实 Electron 两次启动验证，不得从用户 Keychain 提取或打印真实 Key。签名变化可能触发系统授权，不能把伪造 `safeStorage` 的单元测试记录为平台验证。若所选时机不能保证身份，需先完成受控密钥迁移设计再宣告旧设置完全兼容。[Electron 官方 `safeStorage` 文档](https://www.electronjs.org/docs/latest/api/safe-storage) 也说明 macOS 使用 Keychain 且一致代码签名影响其应用识别。

## 最小集中命名设计

建议以纯命名表与带文件身份的解析器组成一个小模块边界。下面是建议接口，名称可调整，行为应保持一致。

```ts
type BrandFamily = "legacy" | "current"
interface BrandNames {
  family: BrandFamily
  appMarker: string
  appIdentity: "Xuanxiangxiezuo-Desktop" | "XaanInk"
  workManifest: string
  storage: string
  storageRequired: string
  lock: string
  audit: string
  auditType: string
  leaseTemporaryPrefix: string
  restores: string
  preserved: string
  migrationStagePrefix: string
  rootRecoveryPrefix: string
}
const LEGACY_NAMES: Readonly<BrandNames>
const CURRENT_NAMES: Readonly<BrandNames>

// 已有 marker 的路径、原字节、身份和 names 为同一个观察结果；assertCurrent
// 在现有目录/文件身份边界中重验，不能只缓存首次存在性。
readApplicationBrand(root): Promise<BrandObservation<ApplicationMarker>>
readApplicationBrandImmediately(root): BrandObservation<ApplicationMarker>
readWorkBrand(root): Promise<BrandObservation<WorkManifest>>
readWorkBrandImmediately(root): BrandObservation<WorkManifest>
// 创建仅在已证明空目录时显式用 CURRENT_NAMES；解析器不自行初始化。
```

纯表可放在 `desktop/shared/brand-names.ts`，文件解析器放在 `desktop/core/brand-names.ts`。让 `root-ownership.ts` 引用纯表/两格式 schema，解析器复用 `root-ownership` 的安全读取，避免循环导入与复制不完整的文件安全实现。只在底层 reader 增加同步分支，维持现有启动/恢复的同步最终证明边界。

| 内容 | 旧家族 | 新家族 |
| --- | --- | --- |
| 应用 marker 文件 / `app` 值 | `xuanxiang-app.json` / `Xuanxiangxiezuo-Desktop` | `xaanink-app.json` / `XaanInk` |
| 作品 manifest | `xuanxiang-work.json` | `xaanink-work.json` |
| 存储指针 / 必须存在见证 | `xuanxiang-storage.json` / `xuanxiang-storage-required.json` | `xaanink-storage.json` / `xaanink-storage-required.json` |
| writer lease / 审计 | `.xuanxiang-lock` / `.xuanxiang-lease-recovery.json` | `.xaanink-lock` / `.xaanink-lease-recovery.json` |
| 审计 `type` / 临时前缀 | `xuanxiang-work-lease-recovery` / `.xuanxiang-lease-recovery-` | `xaanink-work-lease-recovery` / `.xaanink-lease-recovery-` |
| 已恢复的作品候选 | `.xuanxiang-restores` | `.xaanink-restores` |
| 目录迁移 stage / recovery 前缀 | `.xuanxiang-migration-` / `.xuanxiang-root-recovery-` | `.xaanink-migration-` / `.xaanink-root-recovery-` |

规则：

1. 应用 marker 仅允许两个准确的「文件名 + app 值」组合，保持 `schemaVersion: 1` 的其他字段严格校验。作品 manifest 内容结构原样保留，family 由准确文件名决定。两个 marker 同时存在，即使内容相同也拒绝；单个损坏、symlink、hardlink 或身份变化也不能改试另一家族。
2. 一个已存在目录确定家族后，全程使用该家族。旧作品在新应用根目录中仍是旧作品；新作品在旧应用根目录下也应创建新作品家族。作品 catalog 不用记录或修改品牌，可根据对应目录权威 manifest 重新解析。
3. 新作品创建的非空目录重试路径也必须先解析两类 manifest；`creating -> ready` 写回同一个已观察 manifest，不另外写新文件。空目录才选择新家族。
4. 旧 storage pointer、required marker 与 `.xuanxiang-restores/<id>` 必须连同旧 manifest 一起沿用。缺失旧 pointer 且旧 required marker 存在仍然报错，不能因为查新文件而回落 `database`。遇到异家族控制文件应失败关闭并保留原字节。
5. writer lease 使用作品家族；全局 inbox 没有作品 manifest，使用其父应用根的家族。不得以锁是否存在来推断家族。取得锁前必须拒绝另一家族锁/审计；释放、`assertHeld()` 与恢复需一直绑定所选锁目录及 owner 文件身份。恢复旧锁写旧 audit 类型，不能生成第二套新审计后删除旧锁。
6. 新目录迁移保持源应用根家族，包括其 marker；这属于移动旧数据，不能藉此升级格式。已有 journal 的 stage/recovery 从 journal 中的准确字符串与源家族校验，保持 checksum 的原始语义。新操作在当前源家族内生成新的控制文件。
7. 固定列表与路径分类器可以识别两类名称，但获得删除、复制、写入权限时仍必须绑定当前家族及现有 ownership proof；单纯扩大 allowlist 不构成写入授权。所有导出保护则同时封锁两类内部名字、两类临时审计名字和两个 marker，包含未注册/离线目录。
8. 旧导入格式和值必须按原字节/严格 schema 接受，新导出只写 `xaanink-settings`、`xaanink-local-templates`。不要先全局替换输入 JSON 再解析；那会修改用户模板正文与 checksum。退役备份格式只作为历史兼容/隔离证据保留，不能恢复已取消功能。

## 启动与目录选择

`desktop/main/index.ts:54` 的注释明确实例锁目录在 dataRoot 改变时仍需稳定，`:56` 当前固定旧 bootstrap，`:59` 将其设为 `userData`，`:668` 才取得锁。新的路径选择应在上述位置同步执行，读完候选目录状态之后才创建选中的目录；不能先创建新 bootstrap 然后回头尝试旧目录。

- 原旧 bootstrap 已存在时继续使用它，包括旧 pointer、自定义 dataRoot、未完成 journal/relocation/旧恢复记录。它存在但损坏、无法访问或只剩维护证据时要报错，不能退回新安装。
- 新旧 bootstrap 同时存在而都包含权威状态时，应报告冲突并保留两边，不自动合并/覆盖。没有旧 bootstrap 时可使用新 `XaanInk` bootstrap；检查旧默认根时仍须验证其真实 marker。
- `DataRootManager.resolve()`（`desktop/core/data-root.ts:165`）优先验证已有 pointer；保留该优先级。没有 pointer 时，发现合法旧默认根应继续打开旧根；发现非空/坏旧默认根须失败关闭；没有旧状态才把新默认根设为 `~/.xaanink`。
- `desktop/main/index.ts:192` 与 `:674` 的 ordinary/maintenance 默认根都要使用同一个选择结果；测试隔离 root 与 bootstrap 必须完全阻断宿主旧目录回退。
- 旧 bootstrap 的稳定锁选择与 Keychain 初始化身份需分别记录；前者避免跨版本两个应用宿主同时运行，后者避免设置存在但 Key 解密失败。

主代理实现的启动 helper 建议接口为 `selectBrandStartupPaths({ appData, home, isolatedRoot }) -> { bootstrap, defaultRoot, encryptionFamily }`，同步、只读地完成路径选择。main 根据结果创建唯一 bootstrap、设置 `userData`、决定初始化加密名称并取得实例锁；`defaultRoot` 必须同传 ordinary 与 maintenance，`encryptionFamily` 不能由可见产品名反推。该 helper 不调用 `app`，测试传入全部隔离父目录；不要将固定宿主路径写入测试。

## 必须覆盖的实现文件

以下清单是本轮 literal 命名查阅得到的现存耦合点；源码证据引用的是改名前行号。

| 文件 | 关键依据与应修改范围 |
| --- | --- |
| `desktop/service/workspaces.ts` | `:35/:48` 锁；`:83/:103` 应用 marker；`:147/:162/:176/:193/:209/:306` 创建、重试、打开、连接都硬编码作品 manifest。集中解析后绑定同一观察结果。 |
| `desktop/service/workspace-storage.ts` | `:10/:11` manifest 与 required marker；沿用目录家族，保持 guard。 |
| `desktop/core/work-storage.ts` | `:27/:36/:41` storage 文件、候选边界与 missing-required 保护；不能误回落原数据库。 |
| `desktop/service/closed-work-lease-target.ts` | `:17` 关闭后 catalog 校验也必须支持两个 manifest，并继续验证 ready/id/novelId。 |
| `desktop/core/work-lease-recovery.ts` | `:10/:17/:61` audit 文件、schema 类型、lock；`:144/:155/:182/:193/:219/:249/:256` 恢复全程必须绑定 names，不能破坏同步 delete 边界。 |
| `desktop/main/inbox-lease-recovery.ts` | `:21/:23/:45/:60/:66` 无 manifest 的 inbox 使用应用根家族，并持续封锁另一家族锁。 |
| `desktop/core/root-ownership.ts` | `:8` app schema；`:34/:36/:42/:54` marker、recovery、嵌套作品/lease 边界；`:37` 的 `slice(25, -5)` 必须改成正则 capture 或准确前缀长度。 |
| `desktop/core/root-inventory-paths.ts` | `:7/:8/:28` 固定 ownership 路径与 recovery 正则，接受两类准确名称。 |
| `desktop/core/data-root.ts` | `:102/:231` journal stage/recovery 校验；`:143` marker；`:313` lease inventory 必须包含所选 marker；`:548/:842` 新 recovery/stage 生成。旧 journal 的所有恢复阶段仍应可读。 |
| `desktop/core/root-authority.ts` | `:133` 同步 marker 观察；返回/最终断言必须继续绑定实际 marker 的原文件 proof。 |
| `desktop/main/owned-root-files.ts` | `:19/:49/:61` 所选 marker、两种 inbox lease 停机检测、清单完整性；未知内容仍保留。 |
| `desktop/main/file-export-target.ts` | `:3/:4/:20/:21` 两套内部名称、临时文件、marker 的导出保护，尤其离线未注册目录。 |
| `desktop/core/configuration-transfer.ts` | `:53/:143` 双格式导入、新格式导出。 |
| `desktop/shared/template-library.ts` / `desktop/service/template-library.ts` | `:14` schema 与 `:115` export，双格式导入、新格式导出。 |
| `desktop/main/index.ts` | bootstrap/defaultRoot/密钥初始化、全局显示品牌/协议、恢复导出格式由主代理统一。 |
| `desktop/core/application-backup-inventory.ts` 等活动历史证明 reader | 保留旧备份元数据兼容；新 marker 在完整性验证时也能识别。不改取消范围，不新增备份入口。 |

无需改写未含品牌的 `catalog.json`、`state.json`、`drafts.json`、`data-root.json` 文件名、数据库业务 ID、模型引用与现有 revision。`desktop/service/root-startup.ts:46` 的恢复/resolve 顺序和 `:59` 的首次引擎打开边界须保留。

## 测试接口与用例建议

在独立用例审核后执行 TDD。保持一套明确 legacy fixture 与一套 current fixture；不能把所有旧测试夹具批量改名后宣称兼容通过。

1. **命名 reader 单元测试**：旧/新 marker 正确组合；无 marker 不初始化；双 marker、错 app 值、损坏 JSON、symlink、hardlink、解析后的文件/目录替换均拒绝；临时路径调用无需用户目录。为同步和异步 reader 验证相同行为。
2. **作品集成测试**：旧目录已含旧 manifest/storage/required，正常打开并写真实数据且只使用旧锁；新作品只生成新 manifest/storage/required/lease；在旧应用根下创建新作品也使用新作品家族；两套目录均关闭重开；创建请求重试/阶段恢复不出现双 manifest。
3. **writer lease 测试**：已有旧/新 live、foreign、stale、未知内容锁都阻止普通打开；legacy manifest 加 current lock（或反向）拒绝，原字节不改；旧/新恢复分别使用对应 audit/type，并保留现有 owner/token/identity race 测试。inbox 同样验证父根家族。
4. **存储指针测试**：legacy candidate 继续读取原 `.xuanxiang-restores/<id>`；缺失 legacy pointer 与旧 required 共存必须报错；跨家族 pointer/required/candidate 与双 pointer 拒绝；禁止以 `original` 结果假通过。
5. **根目录测试**：旧 bootstrap 的自定义 pointer 优先于两个默认根；坏旧 pointer/旧非空默认根/未完成维护记录不创建新库；全新安装生成 current marker/defaultRoot；旧与新根迁移/重定位分别成功；旧 copying/verified/committed/cleanup-pending/rollback-pending journal 可恢复，原 stage/recovery 与 checksum 不被替换。测试覆盖命名前缀 UUID 提取，不写魔数长度。
6. **输出保护测试**：两家族离线 app/work 内部文件、lock/audit/temp/candidate 路径均被导出 guard 拒绝，普通作品稿件路径仍可用；迁移清单同时识别合法两家族 marker，不授权嵌套独立作品/锁。
7. **格式测试**：用原样旧配置/模板 JSON 导入并应用，用户正文中旧字串保持原文；新导出只使用新 format；未知 format/version 仍拒绝；备份入口依然退役。
8. **真实 Electron 隔离验证**：假 Key 在旧初始化身份加密，在新应用旧数据兼容启动中可解密；确认显示名是新品牌；新安装可加密/关闭/重开解密。记录不含 Key/密文。协议改名后验证现有应用设置、模板与 journal 草稿仍恢复；若浏览器 sessionStorage 需要迁移，明确测旧 key 的回退读取与新写入，不把 scheme 改名等同于持久化迁移。

主代理可持有 `desktop/main/index.ts`、可见文案/协议/打包/文档与已有测试的一般品牌更新；兼容实现代理持有上表其余 core/service、marker/lease main 模块与新的集中命名模块。shared schema/format 变更须告知主代理，避免批量替换 legacy fixture。SVG 字标代理继续仅负责已分配矢量资产范围。

审核完成后应将安全兼容值列入品牌残留审计的明确 allowlist：真实 legacy token、真实外部来源链接与不可伪造历史证据。不得以删除这些值达到零搜索结果。
