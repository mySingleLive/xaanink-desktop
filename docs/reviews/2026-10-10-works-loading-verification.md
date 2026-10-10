# 作品加载失败修复与专项验证

日期：2026-10-10。范围：作品列表、遗留写入锁提示与恢复入口、共享列表缓存。按用户要求没有执行全量测试或全量回归；保留此前 Tabs 的样式、排序和业务面板。

## 根因与实现

正式启动路径与作品 metadata 的只读检查确认：1 个关联作品，目录/manifest 身份匹配，其本机锁 owner PID 已退出（ESRCH）。收件箱锁恢复与作品锁是独立的。本次没有读取真实正文、打开第二个真实数据库连接、修改真实 catalog 或替用户移除锁。

原 `/api/novels` 的 Promise.all 因这个单作品拒绝而整体失败。修复后健康数据库摘要照常返回，不可用作品以明确状态显示；全体不可用不会变成空作品阁。目录索引/全局 worker 故障继续显示真实失败。遗留锁只在原来的本机 ESRCH 判断之后取得 typed code，不放宽普通打开权限。

SidebarTree、ChatPanel、ContentTabs 共享同一 envelope 缓存；创建更新保留故障项。侧栏只对准确的遗留锁提供「修复作品锁」，调用既有 workId/start bridge。保存草稿、受控关闭、原生确认、目录/锁复验、审计和冷启动全部保留；其他目录错误只能重试，不输出原始路径或异常。

产物顺序：[技术与测试方案](D:/Projects/xaanink-desktop/docs/reviews/2026-10-10-works-loading-plan.md) → [独立方案/测试/Code Review](D:/Projects/xaanink-desktop/docs/reviews/2026-10-10-works-loading-review.md) → TDD 红/绿阶段 → 本专项验证。没有新增待批准设计阶段。

## 测试与构建

真实数据库红阶段复现普通打开拒绝遗留锁；真实 SidebarTree 红阶段缺少恢复入口。修复后各次正常 runner 完成的最终专项结果如下，合计 68 个互不重复用例通过：

| 命令范围 | 通过 |
| --- | --- |
| 新 `tests/integration/works-loading.test.ts`（真实 PGlite 两作品、作者/删除过滤、排序、部分/全体不可用、字节保持、确认恢复再读） | 2/2 |
| 既有 `tests/unit/desktop-transport.test.ts` 与 `tests/unit/work-lease-handoff.test.ts`（取消/断开、真实死子进程/活 PID、安全关闭/确认、并发和失败重试） | 23/23 |
| 新 `tests/browser/works-loading.test.ts`（真实 SidebarTree + ContentTabs、缓存创建/重试/Web 兼容、全部故障、单次 bridge/pending、先部分成功后全局失败） | 11/11 |
| 既有 `tests/browser/content-tabs.test.ts`、`work-lease-ui.test.ts`、`work-lease-ui-review.test.ts`（触及共享缓存与关闭后界面屏障） | 32/32 |

Next UI build（包括 TypeScript）通过，desktop build 通过，`git diff --check` 通过。其余既有浏览器 fixture 的 `['novels']` 缓存初始化仅适配 envelope；没有以未执行文件宣称测试通过。浏览器新用例没有执行完整 Chat 发送/供应商调用；创建路径使用的真实 helper 与生产调用已独立审查。

复现使用 Node 24；浏览器测试设置 `XAANINK_TEST_CHROMIUM` 为已安装 Chrome 路径：

```text
node --import tsx --test --test-concurrency=1 tests/integration/works-loading.test.ts tests/unit/work-lease-handoff.test.ts tests/unit/desktop-transport.test.ts
node --import tsx --test --test-concurrency=1 tests/browser/works-loading.test.ts
node --import tsx --test --test-concurrency=1 tests/browser/work-lease-ui.test.ts tests/browser/work-lease-ui-review.test.ts tests/browser/content-tabs.test.ts
node scripts/verify-works-loading.mjs docs/evidence/works-loading/new-target
```

## Windows Electron 实际目标

[最终 target-03 报告](D:/Projects/xaanink-desktop/docs/evidence/works-loading/target-03/windows-electron.json)：passed、exit 0、12 条检查记录（包含 3 张截图）、0 页面错误。使用新建隔离目录、两份真实 PGlite 作品、完整正式 React 工作台、本地 IPC、零模型与离线 renderer；没有 HTTP 服务。

实际覆盖健康项与遗留锁并存、健康项打开、原锁与索引保持、全部作品不可用、目录恢复后重试、真实主进程 WorkLeaseHandoff/worker 关闭/核心文件恢复、审计落盘和冷启动后两库可读。原 catalog/manifest 字节和合成章节 id/content 均保持。主代理已查看[混合状态](D:/Projects/xaanink-desktop/docs/evidence/works-loading/target-03/mixed-list.png)、[全部不可用](D:/Projects/xaanink-desktop/docs/evidence/works-loading/target-03/all-unavailable.png)、[恢复后](D:/Projects/xaanink-desktop/docs/evidence/works-loading/target-03/restored-list.png)三张截图。

原生弹窗的响应仅在合成 fixture 中由测试驱动批准；relaunch 请求由驱动计数后执行新的真实 Electron launch。没有声称物理 OS 点击或原生自动 relaunch 被人工验证。实际恢复函数、关闭屏障和文件 IO 运行。未执行 macOS、安装包或完整业务验收。

[主代理 hash 核验](D:/Projects/xaanink-desktop/docs/evidence/works-loading/target-03/hash-verification.json)确认 8 个生产源文件、181 个构建文件、3 张截图与最终报告一致，无 mismatch。target-01 保留 fixture 使用不存在 schema 字段的准备失败；target-02 保留测试驱动 main evaluate 中 require 不可用的失败；target-03 修正驱动后完整通过，未改变生产实现或抹去失败。

## 用户工作台

已启动最终修复版工作台。用户在已有原生流程完成锁修复与重新启动，并明确反馈「已恢复，作品能正常展开」。本次实际用户恢复验收完成；用户作品正文没有进入自动化测试或证据。

恢复后的只读 metadata 核验按实际品牌协议进行，目录/manifest 身份保持匹配：关联作品 1 个、recovered 审计 1 个、当前活进程持有锁 1 个。仅记录脱敏计数，未再开数据库或修改文件。最终独立审核确认 scoped 结果、8/181/3 hash 和截图，无阻塞项。本次不改变其它迁移状态或历史全量测试结论。
