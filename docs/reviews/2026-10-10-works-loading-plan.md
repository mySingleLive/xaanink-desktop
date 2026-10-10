# 作品加载失败修复方案

日期：2026-10-10。仅本次作品列表加载、异常退出锁入口及关联缓存；保留已批准 Tabs 的样式、拖拽和业务面板。用户明确要求专项测试，不执行全量或全量回归。

## 现场与根因

只读诊断使用正式 `selectBrandStartupPaths` 和作品 brand 校验，未打开用户数据库或更改锁。结果：bootstrap 已验证，关联作品 1 个，`lease-stale` 1 个；目录及 manifest 身份匹配，本机 owner PID 检测为 ESRCH。仅输出数量和类别，不输出目录、作品名、正文、Key 或 owner 内容。

`LocalDispatcher.handle(GET /api/novels)` 用 Promise.all 打开全部作品；普通打开正确拒绝遗留锁，单个拒绝使整个列表失败。启动时的收件箱锁修复独立于作品锁。主进程已有 `desktop:work-lease` / `WorkLeaseHandoff` 安全恢复流程，但侧栏失败画面没有入口。

## 技术方案（先独立审核，后测试方案审核）

1. 普通打开遇到确认已退出的本机 PID 时，保留当前拒绝行为，改用 `ContentError(WORK_LEASE_STALE)`，不移除锁，不修改数据库，也不对 live/foreign/uncertain PID 放宽验证。
2. `/api/novels` 先读取严格校验的 catalog，再逐项汇总真实数据库摘要。响应保留 `novels`，增加 `unavailableWorks: {workId, novelId, title, reason}[]`。reason 只有 `stale-lease` 和 `unavailable`；不传原始异常、路径、owner、正文。健康摘要仍过滤本地作者及 DELETED 并排序。catalog/global worker 失败继续失败，不能成为空列表。
3. 共享 `['novels']` 缓存改为统一响应 envelope，由一个 fetch/hook 提供给真实 SidebarTree、ChatPanel、ContentTabs；Chat 创建后的缓存更新保留 unavailableWorks。避免各组件 queryFn 抢占后丢掉故障状态。Web 响应未提供 unavailableWorks 时按空数组兼容。
4. SidebarTree 的不可用作品单独显示标题与原因，不提供展开/业务打开；全体不可用不能显示「还没有小说」。健康树仍可用，保留「重新加载作品」。只有 stale-lease 且具备桌面 bridge 时显示「修复作品锁」，单次调用已存在 `repairWorkLease({type:'start',workId})`。原生确认、草稿 flush、受控关闭、目录/锁身份复验、审计和冷重启全部复用。渲染端不删除文件、不替代确认，也不显示原始 IPC 异常。
5. 完成专项 TDD、独立代码审查、构建和隔离 Windows Electron 验证后，刷新用户实际运行版本。真实作品的最终锁恢复仍需用户在已有原生弹窗确认；先提供可审核的已构建修复，不在实现未完成时索要批准。

## 测试方案（技术方案批准后审核）

| ID | 必须验证的结果 |
| --- | --- |
| WL-01 | 空 catalog 返回真实空列表；健康摘要过滤、排序、契约正确 |
| WL-02 | 真实 PGlite 的健康作品与遗留锁作品并存，健康项可读，故障项为 stale-lease；catalog/manifest/lock 字节保持，普通打开继续拒绝 |
| WL-03 | 全体不可用明确列出故障项；缺失目录/库或身份拒绝不会伪造小说、不重建库、不删除关联 |
| WL-04 | catalog 读取失败保持拒绝；live/foreign lease 不提供 stale-lease 恢复资格 |
| WL-05 | 同一真实查询被不同组件观察时不可用状态保留；正常 Web 响应兼容；创建缓存更新保留故障项 |
| WL-06 | 真实 SidebarTree：健康树与不可用卡共存，全故障无空态，重试恢复，通用故障/无 bridge 无修复入口 |
| WL-07 | 侧栏修复按钮只传 workId/start，重复点击单次；取消可重试，错误不输出原始路径；pending/restarting 不冒充修复成功；现有 pending dialog 保持屏障 |
| WL-08 | 隔离真实 Windows Electron、本地 IPC/PGlite/offline/零模型：遗留锁画面、健康项、重试及批准恢复后的真实内容可读；原 catalog/manifest 和小说业务字段保持 |

先写 WL-02/WL-06 回归并观察失败，再实现。专项复用 workspaces 普通拒绝、work-lease handoff / pending dialog 及本次触及的 Tabs 缓存测试。真实原生弹窗若测试驱动受控响应，只证明实际主进程/文件流程，不声称人工 OS 点击；用户数据不进入证据。
