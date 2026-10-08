# 94 · 本地数据备份批次与回执独立审核

日期：2026-10-08。审核者：独立子代理 `product_revision_review`。

最终结论：**限定 PASS**。两项实际 P2 缺陷 DB94-01/02 已关闭；独立最终相关 Node 27/27、实际 React/BaseUI 9/9 PASS，均无 skip/cancel、退出 0；全量 TypeScript 退出 0。正式冻结 49/49 SHA 与聚合匹配。本审核未修改生产源、作者测试或作者清单。

## 范围和独立性

审核 root 编写的第 28 批：新 `desktop/main/desktop-backup-batch.ts`，`desktop/shared/work-backup.ts` 的应用结果/批次类型和完成提示，`desktop/main/work-backup-manager.ts` 的部分失败合并 delta；`desktop/main/index.ts` 仅新增 helper import 和 WorkBackupManager 初始化回调；`WorkBackupButton.tsx` 的结果显示，以及 `SettingsDialog.tsx` 的“本地数据备份”标签。

审核者此前在第 25 批将原 backup-plan schema 提取为共享文件，此处不对该 schema 或自身维护元数据 helper 重新授予独立通过。原 Scheduler、BusinessGate、原 manager 生命周期和 26/27/29 worker 代码为只读依赖；本轮不扩大到整个 main、worker 数据库或原生操作。

## 实际发现与修复

### DB94-01 / P2（已关闭）：空错误消息使作品范围失败被记为成功

独立测试从实际 `main/index.ts` AST 提取唯一 WorkBackupManager 初始化表达式，使用生产 Manager、Batch、Gate 与真实隔离文件系统。应用范围返回合法成功回执后，作品范围真实 Promise 拒绝 `Error('')`。初版 helper 返回 `workError: ''`，manager 按 truthiness 过滤失败，`runNow()` 实际履行成功并走入完成记录分支，违反“两个范围均成功才推进 lastSuccess”的合同。

修复将空/空白 Error 消息归为固定非空失败提示，manager 和 UI 同时按 `workError !== undefined` 判别失败。原 DB94-01 的拒绝和 plan 不落盘 oracle 不变，独立复验通过。DB94-06 另外以真实组件验证显式空 workError 仍呈现 alert、不显示成功角色。

### DB94-02 / P2（已关闭）：部分失败丢失已验证应用备份的清理数量

应用范围成功但返回 `cleanupPending: 3`，作品范围返回真实失败。初版实际 main manager 的错误消息保留“已完成应用数据备份”，却丢失三项临时数据待清理信息；实际 UI bridge 收到这个 reject 后无法恢复该事实。

修复增加共享 `applicationBackupCompletion`，manager 部分失败消息和 UI 的成功/部分失败显示复用同一真实完成提示。原 DB94-02 oracle 不变，独立复验通过；DB94-05 在实际 React、安装的 BaseUI 和原 Button 中进一步确认成功应用、清理数量、作品失败三者同时保留，角色为 alert 而非完整成功 status。

首轮证据：`docs/evidence/implementation-28/review94-01-independent-main-red.tap`，独立 4 项中 2 PASS / 2 实际 FAIL。修复后 `review94-02-independent-main-green.tap` 为原 4/4 PASS。DB94-05/06/07 是修复后的首次 GREEN，不另造或累计为原始 RED。

## 独立验证

独立新增 4 个 Node 用例（`tests/unit/desktop-backup-batch-94-review.test.ts`），执行实际 main 初始化表达式而非复制其回调逻辑：上述两个缺陷、同一在途混合批次 Promise 的共享、最后作品范围失败时 pause 与 BusinessGate close 等待真实 Promise、关闭后停止准入，以及坏应用成功回执仍尝试作品范围且旧 plan 字节保持不变。

独立新增 3 个浏览器用例（`tests/browser/desktop-backup-batch-94-review.test.ts`），使用实际 React/安装的 BaseUI/原 Button、实际 globals 与 desktop CSS，全部网络请求拦截：部分完成的清理提示、空错误字段，以及真实组件卸载/新实例挂载后，旧 reject 不结束新 busy、不污染新回执；无作品时仍准确显示应用备份及清理数量。没有访问系统文件选择器、真实 worker 或用户桌面。

相关最终检查：

- Node 8 文件共 **27/27** PASS（23 相关 + 4 独立），`review94-05-related-node-green.tap`，约 0.92 秒。包括原 BC77 closeData AST 用例，其注入补 recoveryExports/fileExports 的空 flush，原关闭顺序 oracle 保留；实际 main 原 closeData 仍先 pause/drain，再关闭 worker。
- 实际 React 3 文件共 **9/9** PASS（6 相关 + 3 独立），`review94-07-related-browser-final-green.tap`，约 2.59 秒。不包括邻接迁移 UI 的三个用例，不授其通过。
- 独立全量类型检查 **exit 0、空诊断**：`review94-04-types.txt`。

浏览器相关合跑的第一次运行漏设作者测试所需的 `XAANINK_TEST_CHROMIUM` 环境变量，导致六个作者用例启动前找不到默认浏览器，三个独立用例仍 PASS；保留 `review94-06-related-browser-green.tap`（3 PASS / 6 启动 FAIL）。随后只设置已有 Chromium 1228 的明确路径，未下载浏览器、未修改测试断言，再合跑 9/9。该启动失败不计为产品缺陷。

## 冻结核验与边界

`desktop-backup-batch-frozen.json` 与 `-frozen-v1.json` 字节相同。独立重算 12 files + 2 independentTests + 18 readonly dependencies + 17 evidence，合计 **49/49** 匹配；按 `files → independentTests → dependencies → evidence` 的 `path:sha256` LF 记录、含最终 LF，聚合精确匹配 `1370e6040b0cb8a9849ac72be0567f3781b34781571470cd5ca4b09e43844cb1`。脚本与结果为本审核者新增 `review94-manifest-check.mjs` / `review94-08-final-manifest.json`，未运行作者生成器覆写清单。

有限 PASS 仅覆盖该冻结中的第 28 批 delta。主进程回调测试控制的是 worker 回执/等待，不能代替真实 worker 数据库操作；浏览器测试不能代替 Electron 原生验收。本轮未运行大 PGlite、全站构建、原生 UI、Windows 或 531 条正式验收，也未重授 25/26/27/29 的独立结论。
