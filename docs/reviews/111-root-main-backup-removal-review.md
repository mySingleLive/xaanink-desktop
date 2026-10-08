# 111 · 备份功能移除后主进程与配置独立审核

结论：`PASS_LIMITED_ROOT_MAIN_CORE_ONLY`。在本次主进程、IPC、preload、设置、配置导入导出和旧恢复只读保护范围内，没有发现尚未修复的产品问题。最终正常回归 16 文件 97/97 通过；最新旧临时文件保护增量复核 5 文件 28/28 通过；全仓 TypeScript 检查 exit 0、空输出。两组有 25 项重叠，不能相加成 125 个独立用例。

本审核者曾实现 `desktop/service/index.ts`、`desktop/service/workspaces.ts` 的移除改动，所以这两文件明确排除于独审结论。没有编辑本审核的六个生产文件。没有启动新的 PGlite、Electron、原生选择器、模型或网络付费任务；不授完整产品、真实原生流程或正式 531 条验收通过。

## 最终源码范围与行为

只读审核范围为 `desktop/main/index.ts`、`desktop/shared/ipc.ts`、`desktop/preload/index.ts`、`desktop/core/settings.ts`、`desktop/core/configuration-transfer.ts`、`desktop/main/legacy-recovery-preflight.ts`。

- 主进程与桌面桥不再暴露备份、候选恢复和应用恢复业务入口。`DesktopBootstrap` 为普通 `Bootstrap`；普通工作台仍通过实际同步 worker 创建函数、原根启动屏障、规范根目录和 session 校验启动。
- 首个同步分支先进行旧恢复只读保护，再执行原目录定位与迁移维护 triage。无旧应用恢复证据时，普通迁移 request/journal 交由维护入口；物理丢失目录直接进入严格定位。首次 bootstrap 不创建新的恢复控制文件。
- 旧 work barrier 非空时阻止普通启动；已完成的空 barrier 保持原字节。旧 application request/phase/receipt/layout 及其临时前缀进入严格只读检查；未发布 `.application-restore-*` 临时文件明确阻止普通启动，不自动执行、确认、清理或重写。
- 草稿 persist/read/ready 保留当前窗口与 session 归属约束、ready 门槛和持久回执确认。关闭流程继续等待已准入业务、会话授权、实际文件导出 IO、配置 IO、数据库关闭、草稿队列、元数据门及普通迁移交接。
- 菜单和 native command 继续受正常 business gate/closing flow 约束；macOS 窗口关闭后的正常重开与未决迁移保持原行为。
- 设置只兼容读取两个已知且有效的旧备份字段；读取不改原 state 文件。后续正常 CAS 更新保留其他偏好并移除旧字段。便携配置不再导出或生成它们的 selectable path，正常审阅后导入仍有效。

## 独立用例与夹具修正

新增 `tests/unit/backup-removal-root-independent-review.test.ts` 的 7 个用例使用实际主分支 AST、实际 legacy/relocation/maintenance preflight、实际 `RootMigrationRequests.prepare/arm`、`VersionedStore` 和配置导入导出：

1. 无 pointer/history 的首次 bootstrap 正常选中工作台，已有文件保持原样。
2. 原 API 生成的 armed 普通迁移 request 配合无效 journal 仍选择 maintenance，不被无关旧备份预检拦截。
3. 实际源目录物理失联时选择直接定位，原 pointer 和保留源文件不变。
4. 尚未结束的旧 work recovery 在选择任何工作台/窗口之前阻止启动。
5. 实际旧 state 读取保持字节，下一次正常 CAS 写入保留作者、字体等其他设置。
6. 旧 portable 备份字段没有可选路径；无效选择拒绝后原审阅能力仍可用于正常主题导入。
7. 已完成的旧 work barrier 原字节惰性保留，正常路由继续。

这些是隔离 FS/主分支测试；Electron、启动目标及 native lock/owner ports 为正常限定夹具。测试没有实际启动业务数据库，也不声称空 inbox 已通过 PG/schema 健康验证。隔离新 FS 夹具路径保留在 TAP 输出。

获 root 授权更新四份原 AST 夹具：`root-startup-main.test.ts`、`root-startup-review.test.ts`、`root-relocation-main.test.ts`、`file-export-main-review.test.ts`。前三补真实同步 worker 创建源码和普通只读保护依赖，保留普通启动路径、首次 await 前屏障及原 triage 断言；旧 lost-backup 正向入口被撤销，其原文件完整复制到 `docs/evidence/backup-removal/root-relocation-main-before-removal.test.ts`，当前用实际 top branch 验证直接 relocation。导出夹具只补无恢复授权的正常 conversation/draft/metadata/workLease 依赖；旧文件完整复制到 `docs/evidence/implementation-40/mixed-test-originals/file-export-main-review.test.ts`，14 个原 assert call 逐项文本完全相同，实际导出写入与窗口归属 oracle 未改。

## 原始失败与最终证据

证据目录：`docs/evidence/backup-removal/`。

| 证据 | 实际结果 |
| --- | --- |
| `independent-root-01-old-harness-attempt.tap` | 旧 AST 夹具缺新增依赖的原始失败保留；不记为产品 RED |
| `independent-root-02-normal-harness-green.tap` | 三份启动/定位夹具 18/18 GREEN |
| `independent-root-03-actual-fs.tap` | 新增独立真实 FS 7/7 GREEN |
| `independent-root-05-normal-related.tap` | 95/97；两个旧导出夹具缺 `conversationDirectories` 的原始 ReferenceError 保留 |
| `independent-root-06-normal-related-final.tap` | 同 16 文件最终 97/97 GREEN，7.03 秒，exit 0 |
| `independent-root-07-fulltypes.txt` | 全仓 types exit 0，空输出 |
| `independent-root-08-readonly-inputs-after.json` | 审核中 root 更新了 legacy guard；透明记录 1 个源变化，其余 5 个未变，不声称期间全部冻结 |
| `independent-root-10-final-guard.tap` | 最新 guard 上复核 28/28 GREEN，2.83 秒；含 110 作者保留的三份既有临时/未知前缀 oracle，只读复跑不认领其发现 |
| `independent-root-11-final-fulltypes.txt` | 最新增量后全仓 types exit 0，空输出 |
| `independent-root-09-final-inputs-before.json`、`independent-root-12-final-hashes.json` | 最终六个生产输入前后 SHA-256/字节全部一致，changed 0 |
| `independent-root-13-finite-summary.json` | 有限范围、日志、测试边界及最终源/test/copy SHA 清单 |
| `independent-root-14-root-freeze-scope.json` | 六个审核源码与 root 的 `implementation-40/backup-removal-frozen.json` 全部一致，mismatches 0；只核本审核范围 |

Root 冻结清单文件 SHA-256 为 `655e82bd840a9bbb0c3b027c4df88d738204b5b6bf61318b4922b006943574a5`。本审核没有修改该清单或既有 110 审核证据，也没有把 root 的构建/其他用例成绩并入上述独立执行数量。

原 `RS67-09` 是实际 worker ready catch 的失败关闭路径夹具；本报告不据它独审自身 service 的完整初始化或真实 PG 行为。正常 read/save/close/menu 的主要证据为保留原断言的主进程与实际 journal/export IO 回归。

## 限制

本次完成了限定源码与正常 FS/AST 回归审核，不覆盖真实 Electron 启动、物理 native picker、业务数据库全流程、Windows 或 UI 全流程。正式 531 条仍为 `all-not-run`。既有备份、恢复控制、snapshot 文件和此前失败日志没有因本审核被删除；取消后的旧恢复 native 测试没有重启。本报告不替代 service 的另一位独立审核者、构建结果或最终用户验收。
