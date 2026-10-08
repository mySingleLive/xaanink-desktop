# 玄印写作持久化命名兼容实现

2026-10-08。产品名称为「玄印写作」/「玄印」/「XaanInk」。本实现依据已通过的 121/122 技术方案、123 测试用例与 125 独立测试审核；用户选择「兼容旧版数据，新建数据使用新名称」。源代码已冻结，等待独立代码审核与主代理组合验收。

## 实现契约与审核重点

- `desktop/shared/brand-names.ts` 是独立、冻结的 14 字段纯表。legacy 值原样保留；current 值使用 xaanink。加密身份由主代理的 startup helper 管理，不给命名表增加隐式字段。
- `desktop/core/brand-names.ts` 提供同步/异步应用及作品 reader。选择依据真实 marker，校验 filename 与 application identity 配对以及严格 schema。缺失、双家族、符号链接、硬链接、目录替换和异家族控制文件都拒绝。观察持有 root device/inode、marker device/inode/size/mtime/ctime 和原字节；同步 `assertCurrent()` 在关键提交处重新验证，不创建或迁移 marker。
- `Workspaces` 空应用目录与新作品写 current；已有 app/work 依据各自 marker 选择 names，旧目录里的新作品仍用 current。storage、required pointer、候选 restores 以及 writer lease 始终使用同一作品家族。create/open/run 保留 marker 观察证明，建书更新 manifest 后重新读取新证明；原目录身份、注册授权、数据库校验和目录边界继续生效。应用路径允许操作系统 `/var` → `/private/var` 等父路径别名，叶目录仍须非 symlink，canonical path/device/inode 与使用中的观察始终固定；inbox lock 使用规范路径。
- 独立 129 审核发现复用已打开连接能跳过品牌重验，以及 case-insensitive APFS 上大写异家族 control 能绕过 entries 比较。已经添加真实 RED 后修复：每次 `run` 在调用业务回调前检查品牌及 writer lease；`retainTask` 获取时同步重验，真实 Prisma adapter 的可选 authority guard 覆盖保留的直接 client。普通 query/execute/script 在 PGlite transaction 的实际队列入口重验，并在提交前重验；显式 transaction 在入口、每条语句与 commit 重验。最终提交发现冲突会回滚，rollback/dispose 保持可执行，同一结束操作仍幂等。inbox 的合法 inboxReady marker 更新后刷新证明。reader 的 control entries 比较与 lease 临时前缀/后缀统一 casefold。
- 正常打开不回收旧 writer lease。恢复保留原来明确确认、closed-work、host、owner、audit checksum 及同步最终删除条件。`WorkLeaseRecoveryOptions.namesForWork` 由生产调用者提供真实家族；低层 legacy fixture 默认保留旧家族。`WorkLeaseHandoff` 转发 selector；inbox 固定由 application marker 选 names。异家族锁/audit/控制文件使恢复失败，不能产生第二套锁。
- `DataRootManager`、owned inventory、root authority 和 relocation 同时识别两家族，并保持实际 marker 原字节及历史 checksum。迁移阶段前缀来自源应用家族；journal 从 stage/id 推导家族并拒绝与清单 app marker 不匹配。恢复文件分类用实际前缀长度解析 UUID，不再依赖旧 `slice(25)`。旧路径不会自动重命名。
- 离线导出目标保护同时识别新旧 app/work marker、storage、锁、audit、restores/preserved 和 lease 临时文件。未知或损坏 marker 仍不能将受保护目录变成导出位置。
- 配置与模板导入接受 legacy/current 格式，生产导出只写 `xaanink-settings` / `xaanink-template-library`；恢复草稿的导出由主代理写 current，本 scope 的 file-export 接受两格式。已有退役备份/恢复 receipt 的外层协议保持旧 literal，用于读原 receipt；这些修改只让其内部 app marker 识别两家族，不增加生产入口。
- 本 scope 的可见中文名称、native menu、asset URL、内部协议、CSP、maintenance/relocation window URL 与 session partition 已改新名称。startup crypto 身份、主入口和 session startup 由主代理实现与验收。

## 文件范围

本代理新增 `desktop/shared/brand-names.ts`、`desktop/core/brand-names.ts`；修改以下实现文件：

| 范围 | 文件 |
| --- | --- |
| core 命名、数据与安全 | `data-root.ts`、`root-ownership.ts`、`root-inventory-paths.ts`、`root-authority.ts`、`root-relocation.ts`、`work-storage.ts`、`work-lease-recovery.ts`、`configuration-transfer.ts` |
| core 历史 receipt 读取 | `application-backup-inventory.ts`、`application-backups.ts`、`application-cold-source.ts`、`application-restore-activation.ts`、`application-restore-drafts.ts` |
| service | `workspaces.ts`、`workspace-storage.ts`、`closed-work-lease-target.ts`、`template-library.ts`、`database/application-restore.ts`、`database/pglite-adapter.ts` |
| main 数据边界 | `owned-root-files.ts`、`root-relocation-preflight.ts`、`work-lease-handoff.ts`、`inbox-lease-recovery.ts`、`file-export-target.ts`、`file-export.ts`、`application-restore-request.ts`、`application-restore-layout.ts` |
| main 产品文案及协议 | `static-ui.ts`、`avatar-assets.ts`、`root-maintenance-window.ts`、`root-relocation-window.ts`、`inbox-lease-recovery-window.ts` |
| shared 导入 schema | `template-library.ts` |

`desktop/main/index.ts`、`desktop/main/brand-startup-paths.ts` 与 session scope 属于主代理。本代理仅持有新增三份兼容测试；已有产品测试中的新生成路径/format 断言由主代理适配，明确 legacy fixture 原样保留。

## TDD 与已执行验证

运行时使用 `PATH=/Users/dt_flys/.nvm/versions/node/v24.18.0/bin:$PATH`，所有真实数据库与文件夹具隔离在临时目录，没有触及用户作品、配置或 Key。

| 验证 | 实际结果与证据 |
| --- | --- |
| 主代理 RED | `/private/tmp/xaanink-brand-red.log`：15 执行条目，2 pass / 13 fail；包含 reader/helper 缺失与真实数据兼容失败。 |
| reader + 真实数据集成 | `/private/tmp/xaanink-brand-compat-step2.log`：23/23 pass，无 skipped；覆盖双家族真实 PGlite 保存重开、候选 storage、迁移与提交中断恢复。 |
| 最后 Workspaces/lease 修改复验 | `/private/tmp/xaanink-brand-work-final.log`：7/7 pass，BDC01–05；BDC05 两家族增补真实已退出 owner 的明确恢复与对应 audit 文件/type 校验。 |
| 既有租约安全组 | `/private/tmp/xaanink-brand-lease-safety-node24.log`：63/63 pass；work recovery、handoff、inbox recovery、work storage。初次使用旧系统 Node 的 7 个 `Promise.withResolvers` 运行时错误在 Node 24 重跑后消失。 |
| reader + startup | `/private/tmp/xaanink-brand-units.log`：20/20 pass。 |
| 三份完整兼容测试最终复验 | `/private/tmp/xaanink-brand-compat-final.log`：31/31 pass，无 skipped，148.6 秒；包含最后新增的双家族真实 stale lease 恢复与 audit 断言。 |
| 主代理组合复验 | `/private/tmp/xaanink-brand-green.log`：36/36 pass；主代理报告 foundation typecheck exit 0。 |
| 本代理类型检查 | `/private/tmp/xaanink-brand-foundation2.log`：`npm run typecheck:foundation` exit 0。 |
| diff whitespace | `git diff --check` exit 0。 |

独立代码审核后新增回归及修复证据：

| 验证 | 实际结果与证据 |
| --- | --- |
| warmed slot 两家族 RED | `/private/tmp/xaanink-brand-warm-red.log`：BDC05 两项 `Missing expected rejection`，明确暴露真实第二次写入被放行。 |
| retained task 两家族 RED | `/private/tmp/xaanink-brand-retain-red.log`：BDC08 两项 `Missing expected rejection`；退出 run 后保留实际 client，再追加异家族 audit 后才放行真实写入。 |
| actual engine queue RED | `/private/tmp/xaanink-brand-queue-red.log`：BDC09 `Missing expected rejection`；信号证明 prequeue guard 已完成，真实 transaction 持有 engine queue，foreign control 后才释放 queue。 |
| casefold RED | `/private/tmp/xaanink-brand-case-red.log`：BRN04 两家族大写控制文件拒绝断言失败。 |
| authority GREEN | `/private/tmp/xaanink-brand-authority-green.log`：5/5 pass；warm slot、retained client、真实事务先写后冲突的完整回滚、之后事务仍可运行、等待实际 engine queue 的写入均覆盖。 |
| 最后类型检查 | `/private/tmp/xaanink-brand-foundation3.log`：foundation typecheck exit 0。 |
| 最后 adapter/reader/lease 安全组 | `/private/tmp/xaanink-brand-final-safety.log`：87/87 pass，无 skipped，6.4 秒；真实 adapter 的 commit 幂等与队列/事务行为、12 reader（含 casefold）、63 lease/storage 安全回归。 |
| 审核修复后的完整品牌组 | `/private/tmp/xaanink-brand-final36.log`：实际 35/35 pass，无 skipped，167.1 秒；14 数据集成、12 reader、9 startup（含主代理新增合法 first-run inbox 初始化）。日志名字不作为实际条目数量。 |
| canonical inbox 路径收尾复验 | `/private/tmp/xaanink-brand-alias-final.log`：11/11 pass，无 skipped，21.5 秒；真实 chat detached 任务及 conversation-transfer（含建书 catalog 失败后重试）。 |

BDC08 两家族及 BDC09 为 129 审核后新增实际回归；BDC05 扩展 warm slot，BRN04 扩展大写控制。独立 reviewer 已审核 retained task 和 adapter guard 方案；等待其最终差异复核。本代理最终代码已再次冻结。reviewer 同意将 inbox 的 engine/resources storagePath 固定为 connectionRoot.path，使独立 close flush 也使用已验证 canonical 路径；最后这行修正由已有 alias/conversation 回归 `/private/tmp/xaanink-brand-alias-final.log` 补验通过。

补充 `/private/tmp/xaanink-brand-root-safety.log` 已结束：224 tests，211 pass / 13 fail，无 skipped；失败为 CFG01 旧配置 export format、RL100-06 菜单退出名称、root-relocation-main 源码提取和 root-relocation-window 的旧 session partition 断言。已通知主代理按实际新产品名字与启动代码适配，未弱化 schema 或安全断言。`/private/tmp/xaanink-brand-authority-regression.log` 为 canonical 路径及 adapter 初次补验：35 tests，33 pass / 2 fail；CHAT34-I05 为已有新生成 manifest 的旧路径断言，交由主代理适配；另一项显式 transaction 同 ending 幂等回归已修复并纳入最终安全组。

这些证据证明本 scope 的实现和隔离回归；不能替代全量核心用例、打包离线启动、真实 macOS safeStorage 兼容、native 菜单/图标验证。上述平台验证及最终组合验收由主代理记录，未实际执行的平台保持未执行。
