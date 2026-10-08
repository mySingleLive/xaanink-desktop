# 110 · 撤销备份功能独立代码审核

结论：本轮备份功能移除的代码与构建一致性有限 PASS，最终以 freeze v2 为准。三个独立真实 FS 拒绝边界已修复，并保持原 oracle 复验通过；没有遗留本轮阻断 finding。此结论不代表完整桌面应用或 530 项正式验收通过。

本轮依据用户最新取消全部备份功能的要求，审核自动备份、手动备份、列表、应用/作品备份恢复以及数据库升级前隐式 dump 的移除。正常保存、版本事务、草稿保留/查看/复制/导出、目录迁移、已存在 work storage 权威指针与 writer lease 都继续属于有效范围。历史产物和失败日志保留，不改写成通过。

## 独立发现

| ID | 实际触发场景 | 原结果与修复范围 |
| --- | --- | --- |
| BR110-R01 | bootstrap 内存在旧 publisher 实际生成的 `.application-recovery-UUID.tmp`，普通 data-root 指针仍合法 | 新 `legacy-recovery-preflight` 漏识别 namespace，直接允许普通启动；`review110-01` 为真实 FS RED。实现方扩大到原 reader 负责的完整 namespace，原 oracle 保持。 |
| BR110-R02 | bootstrap 内存在未知 `application-recovery-unknown.json` | 同样绕过旧严格 reader；`review110-01` 为真实 FS RED。与 R01 同根因，未知记录必须拒绝，原文件不清除。 |
| BR110-R03 | bootstrap 内存在旧 activation 实际生成的 `.application-restore-UUID.tmp`，未发布 pointer/receipt 原件还在 | `review110-02` 中 R01/R02 已绿色，R03 真实 RED。仅扩大 matcher 不足，因为旧 receipt reader 不识别带点 temp；实现方需显式阻断未发布 activation 临时文件。 |

独立测试位于 `tests/unit/backup-removal-110-review.test.ts`。测试只使用自建隔离目录；不打开数据库、不调用模型、不读真实用户数据。实现方没有改这些攻击或拒绝断言。最终 `review110-07-final-original-fs-green.tap` 为原三项 3/3 GREEN：完整旧 request namespace 交给严格只读 reader，带点未发布 activation 临时文件明确拒绝；所有控制与 pointer 字节保持。另指出 `ConfigurationTransfer.tsx` 的两个死备份标签，最终生产已清理。

## 当前代码核查

- 普通 main/shared/preload 不再提供备份或恢复的六个 IPC 能力，独立只读查看确认普通请求、设置、配置、草稿、目录迁移、异常作品锁、窗口/菜单及模型服务仍保留；main 在新 legacy 只读检查之后才选普通 worker/session。
- worker 的两种备份 RPC 已删除，`Workspaces` 不再有备份/恢复业务方法或 cache。新作品只准备 assets；连接继续使用事务式 schema migration，不生成升级前 dump。已存在备份、归档、未知文件无清理路径。
- settings/schema 对旧 interval/retention 两个已知且合法字段做读取兼容，并从当前状态/后续写入/portable export/import plan 中剥离；其他用户、外观、模型与快捷键保留现有 CAS。
- 旧 work storage pointer/required marker 仍严格选择已提交的真实数据代；缺失/损坏/身份不符不回退到旧原库。保留只读历史解析与 DataRoot managed inventory，以支持完成历史与真实目录迁移；有名字包含 backup/restore 的兼容依赖不代表重新开放业务入口。
- UI 的备份区和恢复专用路由已移除，普通保留草稿仍可查看、复制、导出。设置中的目录迁移、默认作品父目录与工作台恢复、配置导入/导出继续存在。

## 证据与限制

`review110-03-archive-reread.json` 独立重读最新退役清单：36 份生产源、111 份专属测试退役，4 份混合测试原件另存，共 151 行；全部 archive SHA 正确，147 份退休原路径不存在，4 份混合当前 hash 正确。声明的 658 个生产 inputs 与退役源无交集。

`review110-04-independent-literal-imports.json` 从普通 main/service/三份 preload 与应用页面六个入口独立解析 TypeScript 字面量 import，得到 717 个输入，没有任何退休源。该统计包含 type-only imports，是静态上界，不是 runtime call graph。三条 CSS 解析限制已在 `review110-05-css-resolution-note.json` 逐条核实为两份现存样式资产，没有剩余未解析路径；第一次统计原件保留，未当成产品失败。

最终冻结为 `docs/evidence/implementation-40/backup-removal-frozen-v2.json`，SHA256 `58ab5da4a5b6ae3006a6746d4bf0e8d35cb8a0c936c70dcdc3daf0be75936dec`。独立 `review110-12-final-v2-source-artifact-reread.json` 重读 662 个生产 inputs、243 个实际 dist/out 文件，全部 hash 匹配；151 份历史归档原件也再次一致。36 份退役源与实际 inputs 无交集，四个旧 worker/preload entry artifact 不存在，实际 main/preload 不含六个退出的 public channel，main/service 不含退出的 capture RPC。

实际两份 Node bundle source map 有 488 条带内容的源码，逐条 URL 解码后与当前 source 精确一致。v1 manifest 的 379 条 declared observation 与另外 109 条 `%5Bid%5D` 等路由路径在 `review110-09` 已分别独立核实；最终 v2 列出全部 488 条，与独立结果逐条一致。第一次 `review110-08` 将 URL 编码当成文件名而产生解析诊断，保留原件；`review110-09` 明确仅修审核 reader，不改生产或攻击断言，不把审核工具限制称为产品 RED。

v1 SHA `655e82bd840a9bbb0c3b027c4df88d738204b5b6bf61318b4922b006943574a5` 原件未覆写。v1→v2 的 662 个 input hash 仅 `RootRelocationScreen.tsx` 改变，对应一行旧备份恢复引导文案清理；当前桌面 UI/store/lib、public IPC、普通 worker/service 与菜单无剩余公开备份入口、dump 或相关用户文案。v2 的 UI build（包含类型阶段）exit 0。`review110-11` 保存重建期间读取旧 v1 build-ID artifact 的 ENOENT，按已授权构建替换说明，不当产品 RED；最终 v2 全部实际文件已读回。

`review110-06-ui-service-frozen-reread.json` 复核独立 UI v2 与 service 冻结共 11 文件，无变化；原三项独立 FS 与全仓 `tsc --noEmit`（`review110-10-final-types.txt`，exit 0）在生产 v1 冻结之后顺序执行，v2 唯一文案改动不涉及这些核心源码/攻击断言，不重复运行。作者最终普通回归 80/80、Desktop/UI build 与非增量 typecheck 均 exit 0，原日志已逐一读回。作者 service 的新 FS 7/7、相关普通 pure 44/44、实际原 schema 正常 PG 2/2（9.82 秒），UI 实际组件 Chromium 3/3（2.93 秒）作为有限佐证；其中标题带 DESK ID 的开发用例不等于正式用例全场景验收。

审核未另启 PG、Electron/native 或付费模型；用户撤销之后的备份恢复原生任务没有恢复执行。历史日志和退休代码原件不改写为 PASS，三个真实产品 RED 与两次独立审计 reader 的限制均保留。

当前有效正式验收仍为 530 项，全部 `not-run`；退役 `DESK-D08` 与五个混合用例的备份子步骤不会被历史证据提升为 PASS。完整桌面应用、真实 macOS/Windows、系统文件选择器、安装包与全部适用平台验收不在本轮有限代码审核结论中。
