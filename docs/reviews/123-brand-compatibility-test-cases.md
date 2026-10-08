# 玄印写作品牌与数据兼容测试用例

2026-10-08。中文全名「玄印写作」、简称「玄印」、英文名「XaanInk」；用户要求兼容旧数据，新建数据使用新名称。依据已通过的 121/122 方案。本轮只写测试与本文，尚未运行 RED，尚未修改实现；须先完成独立测试审核。

## 冻结接口

`desktop/shared/brand-names.ts` 导出只读、冻结的 `LEGACY_NAMES`、`CURRENT_NAMES`。完整字段和准确字符串由 `tests/unit/brand-names.test.ts` 的独立 literal fixture 定义：family、appMarker、appIdentity、workManifest、storage、storageRequired、lock、audit、auditType、leaseTemporaryPrefix、restores、preserved、migrationStagePrefix、rootRecoveryPrefix。

`desktop/core/brand-names.ts` 导出：

```ts
readApplicationBrand(root: RootIdentity): Promise<BrandObservation<ApplicationMarker>>
readApplicationBrandImmediately(root: RootIdentity): BrandObservation<ApplicationMarker>
readWorkBrand(root: RootIdentity): Promise<BrandObservation<WorkManifest>>
readWorkBrandImmediately(root: RootIdentity): BrandObservation<WorkManifest>
interface BrandObservation<T> {
  names: Readonly<BrandNames>
  filename: string // 该根下的相对 marker 名字
  value: T
  assertCurrent(): void // 同步重验 root、marker 原身份/内容、无竞争家族
}
```

reader 只读取；缺 marker、双 marker、错误 filename/app 对、损坏或非普通独占文件、目录身份变化、异家族控制文件均拒绝。创建空目录的调用者显式使用 `CURRENT_NAMES`，reader 不通过写 marker 修复状态。shared 纯表不导入 core，core reader 复用现有安全读取边界。观察后新增另一家族 marker 必须使原观察的 `assertCurrent()` 失败。

`desktop/main/brand-startup-paths.ts` 导出同步只读函数：

```ts
selectBrandStartupPaths(input: {
  appData: string
  home: string
  isolatedRoot: string | null
}): {
  bootstrap: string
  defaultRoot: string
  encryptionFamily: "legacy" | "current"
}
```

所有路径从传入根计算。已有权威 pointer 优先，其真实身份 marker 校验后 `defaultRoot` 返回 pointer 指向的根；旧 bootstrap 保持原位置，legacy root 使用旧启动加密身份。隔离优先返回 `${isolatedRoot}-bootstrap` / `isolatedRoot` / current，并完全不读取宿主目录。此函数不 mkdir、不写 pointer、不取锁、不初始化数据库。main 在选择后执行这些既有操作并把同一结果传给 ordinary/maintenance。

## 已编写的断言

| 测试 | 文件 | 验证范围 |
| --- | --- | --- |
| BRN01 | `tests/unit/brand-names.test.ts` | 两份命名表的准确协议字段和冻结状态。 |
| BRN02 × 2 | 同上 | 旧/新应用与作品 marker 的同步/异步解析；原字节不变。 |
| BRN03 × 2 | 同上 | 错误 app 值、损坏、版本错误、双应用/作品 marker；作品坏 JSON、错版本/阶段/UUID/字段类型/额外字段严格拒绝。 |
| BRN04 × 2 | 同上 | manifest 与异家族 storage/required/audit/lock/restores 混合拒绝，不增写第二套控制文件。 |
| BRN05 × 2 | 同上 | 应用与作品均覆盖 symlink/hardlink、相同内容的新 inode、原 inode 内容原位变更、另一家族 marker 到达、root 替换使同步/异步观察失效。 |
| BRN06 × 2 | 同上 | 两前缀 recovery UUID 分类及嵌套 work/lease 保护，覆盖原 `slice(25)` 风险。 |
| BRN07 | 同上 | 空目录读取不猜测家族、不创建文件。 |
| BSP01 | `tests/unit/brand-startup-paths.test.ts` | 新安装 current 目录选择只读。 |
| BSP02 | 同上 | 旧 bootstrap 原锁目录与自定义旧 pointer 优先，当前默认根不影响它。 |
| BSP03 | 同上 | 无 bootstrap 时有效旧默认根仍被选择并保留。 |
| BSP04 | 同上 | 旧坏 pointer、指向失联根、无 pointer 的坏维护状态均拒绝且不新建根。 |
| BSP05 | 同上 | 旧非空未知目录和 symlink 不落入新空数据库。 |
| BSP06 | 同上 | 两 bootstrap 均有权威状态时拒绝合并/选边。 |
| BSP07 | 同上 | 隔离目录完全禁止宿主旧状态回退，即使宿主坏状态存在。 |
| BSP08 | 同上 | 当前 pointer/current crypto family 与 inode 替换拒绝。 |
| BDC01 | `tests/integration/brand-data-compatibility.test.ts` | 原样旧 manifest/storage/required + 独立真实 PGlite/Prisma 旧业务数据，保存并关闭重开；旧锁且无新控制文件。 |
| BDC02 × 2 | 同上 | 在两类应用 catalog 下新建均写 current 作品控制，创建重试幂等、真实写入和关闭重开；storage 初始化名字验证。 |
| BDC03 | 同上 | 旧 required 还在但 pointer 丢失时失败关闭，不自动写新 pointer/空库。 |
| BDC04 | 同上 | 旧 `.xuanxiang-restores` 真实候选 DB 仍是权威；保存重开继续候选，原 DB 正文不变。 |
| BDC05 × 2 | 同上 | 两家族真实运行中的 writer lease 被第二 Workspaces 共享拒绝；本家族/异家族 foreign 锁原字节保留。 |
| BDC06 × 2 | 同上 | 真实关闭后的 PGlite inventory、迁移、新/旧 stage/recovery 名称、marker 原字节与 DB 重开/新保存。 |
| BDC07 × 2 | 同上 | pointer commit 后模拟进程中断，恢复同一 journal stage、migrationId、文件证明与 checksum 语义，真实 DB 内容保留。 |

合计 31 个顶层测试（12 reader/classifier、8 startup、11 数据集成）。PGlite 测试不连接模型、不创建 HTTP 服务，所有夹具在 `realpath(mkdtemp(tmpdir()))` 下并在 finally 中关闭真实 engine 后删除。历史字符串只在明确 legacy fixture 中原样保留；不会用实现的命名表反向生成旧夹具。

## 审核后的执行与其他验收

独立审核通过后运行：

```sh
node --import tsx --test --test-concurrency=1 tests/unit/brand-names.test.ts tests/unit/brand-startup-paths.test.ts tests/integration/brand-data-compatibility.test.ts
```

记录真实 RED 后实现再运行同一命令。缺少 proposed reader/helper 的模块错误是可预期红灯；集成文件的业务断言应另外运行以展示旧基线会误写/误读命名，避免只有 import failure。

以下已有安全/业务测试仍需随实现保持通过：writer lease 恢复的 stale/live/unknown owner 和同步最终 unlink race；root journal 多阶段恢复/目录重定位；导出保护的离线 work/app marker、内部/临时名字；旧配置/模板导入和新 format 导出。主代理补充品牌/UI/打包/格式回归，并运行全量活动核心用例。本轮指定文件范围只覆盖命名与数据路径，不能单独声称全部改名验收通过。

真实 macOS 新包还需隔离假 Key 的旧初始化身份加密 → 新显示品牌兼容启动解密、新安装加密/关闭重开解密；菜单/标题/关于/字标；离线启动；正常退出和重开。单元 `encryptionFamily` 只证明选择规则，不能代替 Keychain 平台验证。Windows 未实际运行必须保持未执行。
