# 维护元数据作者移交

2026-10-08，作者 product_revision_review。作者实现与相关验证完成，待独立审核，不自作 PASS。

作者范围：新增 desktop/shared/backup-plan.ts、desktop/service/database/application-maintenance-metadata.ts、tests/unit/application-maintenance-metadata.test.ts；WorkBackupManager 只把原 inline zod 值 schema 引用共享导出。无新增依赖。

合同见 evidence25/application-maintenance-contract.md。源 helper 只读两个可选元数据文件；16KiB、no-follow/single-link、原 barrier.inspect、guard 前后、最终同步 dev/ino/stat-revision/absence 核验。缺失不写、unknown pending 不执行。应用备份 verifyCaptured/17 restore/main/index/Workspaces 接线由 root 后续负责。

证据：01占位行为RED，14/14失败，所有负向oracle要求具体固定code而非任意异常；02首次21/21（14新+7原）；03 lstat overload 类型错误，改为现有 BigIntStats，04全量0（仅类型修复，不计行为RED）；05末次真实lstat期间guard过期实际RED Missing expected rejection；加目录await后guard，06最终22/22，07全量tsc0。MM25-13进一步使用原严格字段合法的failed.message测试坏UTF8，避免靠未知字段碰巧拒绝。

独立 reviewer 可新增探针，不改作者15断言。原文件与所有外来替换始终保留，测试不运行实际定时器/大库/原生窗口。全量531和目标系统验收仍由主代理台账记录。
