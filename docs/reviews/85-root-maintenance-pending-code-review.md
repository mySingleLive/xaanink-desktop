# 85 · 迁移待处理明细独立代码审核

结论：限定通过。三个生产文件的本批明细增量未发现需要修复的缺陷。独立执行相关 50 项 Node 和 6 项实际 React/BaseUI/Chromium 用例，合计 56/56，通过且无跳过；本次全项目 TypeScript 检查退出 0、无诊断。这里不重新认定既有迁移核心、原生闭库与重启流程，也不是 Windows、系统选择器或 531 条正式验收。

## 受审范围与冻结

- 合同：`docs/evidence/implementation-20/pending-contract.md`。
- 生产增量：`desktop/shared/root-maintenance.ts` 的只读明细字段与合法标签检查、`desktop/main/root-maintenance-runner.ts` 的终态关联读取、`src/components/desktop/RootMaintenanceScreen.tsx` 的列表与分页。
- 作者冻结：`pending-frozen.json`，聚合 `b394a3e8d40c9f84f356e5e02f51a3a65015319be5912acbd8405d9ea0d06556`。按 files 后 evidence 的顺序，把 `path:sha256` 用 LF 连接并包含末尾 LF；13 条记录和聚合均与磁盘匹配。本次未修改这些生产文件、作者用例或冻结清单。
- 既有 DataRootManager、RootMigrationRequests、库存与持久化函数仅用作受审增量的真实依赖及隔离夹具，不扩大此前 59/66/72/73 结论。

## 独立验证

`tests/unit/root-maintenance-pending-review.test.ts` 新增 4 项。用真实隔离目录、真实 DataRootManager/RootMigrationRequests/RootMaintenanceRunner 生成已提交的 cleanup-pending journal：原目录的后续 settings 修改仍保留，新根保存迁移前数据。关闭证明、稳定锁和退出回调是注入合同，不是 Electron 或 PGlite 实际关库证据。

| 用例 | 可观察边界 |
| --- | --- |
| PEND85-01 | 重启 runner 从同一回执读到 `state.json`；监听者与调用者修改返回数组不改变后续状态、磁盘 journal、旧新数据或迁移次数。 |
| PEND85-02 | 真实写入带有效校验和的源/目标/nonce/状态/数量/不安全标签变体；明细不匹配时保持 durable count=1、pendingItems=null、原回执与新根，绝不伪造空列表或重迁移。 |
| PEND85-03 | 真正读取 journal 后挂起 await，关闭证明失效时发布 recovery-required 并拒绝继续；恢复证明后仍读取同一 receipt，不新增迁移。 |
| PEND85-04 | 明细 journal 缺失时数量仍为 1 且详情明确未知；仅在真实权威根验证通过后允许继续，消费精确回执，旧副本仍保留。 |

`tests/browser/root-maintenance-pending-review.test.ts` 新增 4 项。独立打包实际 React 组件、已安装 BaseUI 和源 CSS，控制窄 preload 的只读事件/命令，拦截其他网络请求；没有运行工作台、旧 73 截图测试或 Electron。

| 用例 | 可观察边界 |
| --- | --- |
| PEND85-U01 | 45 项逐页访问：20/20/5，上一页和末页禁用正确；中文状态码显示、类似 HTML 的路径只作为文字、不出现 img/link/script、不触发网络/alert；分页无迁移命令，明确继续只发一次 continue。 |
| PEND85-U02 | 接收后原始数组被修改也不污染页面；遍历、4097 字符、数量不符和迟到 revision 不能抹掉最新合法列表与继续权限。 |
| PEND85-U03 | 320×240 窗口里合法 4096 字符相对标签不横向溢出；通过纵向滚动操作下一页及返回工作台，按钮真实 bounding box 在视口内。 |
| PEND85-U04 | null 详情明确不可用，不显示空清单；在第 3 页收到更短 rollback-pending 列表时正确钳制页码、显示剩余一项与原目录说明，权限仍取主进程状态。 |

源码同时核对：明细仅使用 executionNonce 对应的 journal，并匹配源、目标、result migrationId/status/root、完整数量和全部安全标签；读取失败仅退化详情，读取结束后的关闭证明失败不能放行。runner state/subscriber 和 renderer receive 都复制数组。分页每次最多渲染 20 项，所有项通过页码可达；标签不提供路径执行、文件操作或额外授权。

## 证据与异常归属

- `review85-03-independent-node-corrected.tap`：独立 Node 4/4、退出 0。
- `review85-02-independent-react.tap`：独立实际界面 4/4、退出 0。
- `review85-04-related-node-green.tap`：独立合跑 4 文件 50/50（作者明细 3、作者 runner 33、既有独立 runner 10、本次独立 4），退出 0。
- `review85-07-related-react-green.tap`：仅作者明细 2 + 本次独立 4，6/6，退出 0；未运行会写历史截图的旧 UI 用例。
- `review85-05-typecheck.txt`：本次实际全量检查退出 0、零字节诊断。作者 `pending-07-typecheck.txt` 当时退出 2 的 7 条 phase19 nullable 诊断仍保留，不能把作者旧日志说成通过；本次类型结果是后续工作区的实际时点检查，不是对 phase19 产品结论。
- `review85-06-initial-manifest.json`：13 条作者记录和聚合全部匹配。

`review85-01-independent-node.tap` 首跑是 3 通过/1 失败：审核夹具把维护关闭证明和稳定实例锁绑定为同一个 gate，故关闭证明失效后尝试读 ledger 时得到 LOCK_REQUIRED。已把两项注入前提分离，保留原日志；生产边界断言未放宽，四项全部通过。这是审核夹具错误，不是产品 RED，也未要求修改生产实现。

最终独立清单和摘要分别为 `review85-08-final-manifest.json`、`review85-09-final-summary.json`。56 项是本次相关开发检查的唯一并集，不与历史 46/73 或其他共享回归重复累计覆盖率。未完成的真实宿主退出/无活库与 session 写入/冷重启/Windows 验收留在主流程，不由明细审核替代。
