# 63 · 数据根启动接线作者记录

状态：启动模块实现及23项相关作者验证已完成，准备交独立审核；最新全量类型检查有主进程另一作者文件的两项诊断。本文是作者记录，不是作者自评 code review PASS。

范围：service/root-startup、shared/root-startup、service/index 的 ready 段；新 unit12项与真实 built-worker8项。主进程 index 接线由 root 作者负责，不计入本文件的源码审核范围；迁移 core59 的受管空目录扩展由 root 另行处理。

结果与合同见 [启动交接合同](../evidence/implementation-11/root-startup-contract.md)。实际 worker 已证明首次 canonical adopt、pointer失联/坏journal/坏pointer阻断、原资源初始化失败不 adopt、64KiB barrier缺bootstrap阻断、真实迁移根再打开和 pointer-written journal 完成恢复，以及旧3项worker回归；15日志23/23、exit0。全量类型检查10曾退出0，最新16/17仍有另一作者主进程模块类型错误，不能冒称当前全量通过。所有主进程等待都发生在测试未运行 GUI 的启动模拟阶段，不冒称真实 Electron 两平台验收。

发现并保留的实际问题：

1. 原 worker 忽略 bootstrap pointer/journal，失联根会初始化另一套默认库。7项真实 RED 已建立；当前 strict 路径先recover/resolve，再构造 Workspaces，失败仅返回安全code。
2. typed startup error 的 message 可被改写；原直接复用 error 会泄漏内部文本。U10 实际 RED 后统一重建固定字面量。
3. 新 shared barrier 缺 bootstrap 会误入 fixture兼容；ROOT11-08 实际 RED 后只在旧无barrier/4byte fixture保留兼容。
4. 真实闭库迁移丢失14个 PostgreSQL 空目录，导致 PGlite 重开失败；隔离诊断补回原目录后读到同库数据。root 后续扩展持久 journal/受管目录身份，fixture host 提供实际目录清单；ROOT11-02/07 已在15完整合跑中通过。正式启动未临时补目录，core增量仍由另一代理独立审核65。

待完成：root 修复其 `root-migration-request.ts:78` 两项类型错误后的最终 full tsc，以及其他代理独立审核。源码/测试冻结见 implementation-11/root-startup-frozen.json；迁移core是只读依赖，不由63作者自审通过。正式业务/桌面验收清单状态不由此作者记录修改；运行中迁移、Chromium session关闭、已有数据库锁显式恢复、Windows与实际App重启仍需后续集成验证。
