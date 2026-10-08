# 90 · 作品异常退出锁的宿主接线与 UI 独立审核

审核者：product_review；2026-10-08。结论：**限定通过**，本轮未发现需要修改生产源码的缺陷。独立执行相关 Node 54/54、实际 React/BaseUI/Chromium 24/24，全量 TypeScript 检查退出 0、无诊断。新增独立行为用例 15 项；共享回归不重复累计覆盖率。

## 范围和证据边界

主进程/worker 范围最终以 `work-lease-main-frozen-v3.json` 为准：`desktop/main/index.ts` 的作品锁入口与关闭交接、导出保护，worker 闭库证明和受控目标解析，以及 shared/preload 的语义命令接线。UI 范围以 `work-lease-ui-frozen.json` 为准：原 `WorkBackupsPanel`、`DesktopApp` 的关闭屏障和 `WorkLeasePendingDialog`。未修改生产源码、作者测试、合同或作者冻结清单。

19 锁恢复核心和 89 `WorkLeaseHandoff` 的独立结论分开记录；本轮使用这些真实模块验证宿主组合行为，不重新授予其完整核心审核结论，也不扩大到相邻模板、图像、应用备份实现。

Node 主进程用例从实际 main 源码 AST 提取 IPC 回调、权限函数和关闭协调器配置，使用实际 `CloseCoordinator`、`BusinessGate`、`WorkLeaseHandoff`、锁恢复核心及隔离真实文件系统；旧 PID 来自确已退出的 Node 子进程。Electron 窗口、原生对话框结果、业务关闭回执等宿主边界受控，因此不能据此证明真实 Electron 闭库或 OS 对话框交互。worker 用例执行真实 RPC 回调与真实只读目标解析器，开引擎入口由受控函数观察。React 用例直接装配原生产组件、React 19、BaseUI 和应用 CSS；其他工作台业务子组件、main bridge、DraftSession 生命周期受控。

## 独立检查

| 用例 | 可观察边界 | 结果 |
| --- | --- | --- |
| WL90-M01 | 拒绝停止任务后不 flush、关库、显示删锁确认或改动真实旧锁 | 通过 |
| WL90-M02 | 等待物理停止回执后才 flush/关闭；闭库后取消删除仍冷重启，锁与作者文件字节不变 | 通过 |
| WL90-M03 | 原生确认在途时第二 start 拒绝、retry 加入同一交接；仅一次 flush/close/删锁/重启 | 通过 |
| WL90-M04 | 已删锁但结果通知失败保持关闭屏障；retry 不再次 flush 旧缓冲或重写真实审计 inode/mtime/字节 | 通过 |
| WL90-M05 | 确认等待期间原 frame 导航到非受信 URL 后不能授权删除、重启或放行旧业务 | 通过 |
| WL90-M06 | 稳定单实例锁丢失在关闭前拒绝；start/retry 不接受路径、PID、confirmed 等额外授权 | 通过 |
| WL90-W01 | 所有可能打开引擎的 RPC 即使入口失败，也首先撤销已闭库证明 | 通过 |
| WL90-W02 | 仍有 response、start、pending flight 或本地 attempt 时不能签发恢复目标 | 通过 |
| WL90-T01 | catalog 重复 UUID、creating 状态、异作品 manifest 拒绝且文件不变 | 通过 |
| WL90-T02 | manifest 符号链接或额外硬链接不能提升为闭库恢复能力，外部字节不变 | 通过 |
| WL90-T03 | 导出保护保留大小写变体的审计/UUID 临时名；普通作者文档允许导出 | 通过 |
| WL90-U01 | 迟到备份列表不能解除 pending、改变选择归属或重新启用修复/恢复 | 通过 |
| WL90-U02 | 异常结构的 retry 回执仍保屏障，不展示私有 cause；仅明确点击才再发窄 retry | 通过 |
| WL90-U03 | bootstrap 失败时在飞 retry 的实际 DOM 按钮身份和请求保持，后台重载仍禁用 | 通过 |
| WL90-U04 | pending 后原生命令、自定义设置/恢复事件不能打开后台入口；原输入保持、工作台 inert、保存禁用 | 通过 |

定向源码检查同时确认：目标路径来自原 catalog/manifest，renderer 只传 UUID 或 retry；worker 闭库证明须实际 `Workspaces.close` 成功且没有剩余业务活动，原 `Workspaces.close` 本身是单飞。确认前后复核原窗口、webContents、frame 和稳定锁；闭库后不确定结果留在交接屏障，retry 只走 afterClose。UI 屏障不替代 main/worker 授权。异常回执与启动失败不能通过旧 `close-cancelled` 或 closing(false) 放回旧编辑器。

## 独立实跑

运行 Node v24.19.0，以 `--import tsx --test --test-concurrency=1 --test-reporter=tap` 执行。Chromium 为已安装 headless shell 1228；未设置旧截图输出选项。

- `review90-13-related-node.tap`：10 文件，实际 54 PASS，0 FAIL/CANCELLED/SKIPPED，退出 0。此集合为本轮独立 11 项加所选作者/原回归 43 项；不将作者另一个运行集合的 53 项再相加。
- `review90-14-related-ui.tap`：4 文件，实际 24 PASS，0 FAIL/CANCELLED/SKIPPED，退出 0，即作者 15 + 原恢复 5 + 本轮独立 4。
- `review90-15-final-typecheck.txt`：全项目 `tsc --noEmit --pretty false`，退出 0，空诊断。
- 本轮独立测试文件：`tests/unit/work-lease-main-review.test.ts`（6）、`tests/unit/closed-work-lease-review.test.ts`（5）、`tests/browser/work-lease-ui-review.test.ts`（4）。实际执行总计 78 个相关测试，不能等同 531 个正式验收场景。

## 夹具修正历史

本轮没有生产缺陷 RED。所有早期失败原样保留，明确区分如下：`review90-03` 的 1 项失败因审核者 create-work 夹具缺 selection/input，修正 payload 后同一闭库失效断言于 04 通过；05 尚未生成测试文件，执行 0 项；06 的 4 项因审核者 empty-child 插件缺 resolveDir 编译失败，补定位后执行；09 的 1 项因用 visible 等待被 BaseUI inert 合法隐藏的后台错误提示，改为等待已挂载 DOM，原同一按钮/请求、后台禁用和屏障断言保持，于 12 及最终 14 通过。未修改作者断言。

初始 UI 清单审核工具的 08/10 聚合不匹配源于审核者分别使用错误字段和错误聚合范围；30 份文件哈希始终匹配。按作者声明的 `aggregateSha256`、仅 ordered files、逐条 LF 包含末 LF 计算，11 完整匹配。此为审核工具修正，不是冻结文件或生产缺陷。

## 冻结与只读原生附录

初始主清单的 15 files + 7 dependencies + 14 evidence 全部匹配，其 ordered 三组 `path:sha256` 各条 LF（含末 LF）聚合为 `8640116b22b51be170b10e5b96512f64c8ead729e07be3418261fdc2951f36ab`。最终主 v3 纳入原生脚本/构建、只读原生证据、本轮独立源和 UI 冻结引用；生产源码保持相同。v3 的 19 files + 8 dependencies + 31 evidence 共 58 份全部匹配，按相同算法聚合为 `ebc4bb0bb3bc2af82ea2f6ae094532ce212b800706a4fdb715b0366a2017e6da`。v1/v2 保留；v2 曾遗漏实际不含 90 命名的三份独立测试路径，v3 补齐，不影响已执行行为结果。

UI 的 7 files + 14 dependencies + 9 evidence 全部匹配，file-only 聚合为 `319391fd2eacae449937edcf1ffcfb0330289fc5c3cc0e83be7f7ad4a43693d9`。最终清单核验与独立证据指纹另存 `review90-16-final-manifest.json` / `review90-17-final-summary.json`。后续阶段 26 会话或应用备份证明模块不属于本轮最终快照，不回写本轮结论。

根代理提供 `native-work-lease.json`、原生运行日志和 pending/reopened 截图，报告其亲自运行 macOS arm64 Electron 的 3 组开发检查通过：真实 dead-child 旧锁保持、实际 worker.close 后确认异常保持 UI/business IPC 暂停、明确重试后真实审计与旧 PID 退出/新 PID 冷重启，原正文/manifest/未提交 composer 输入保持，0 pageerrors。本审核只读引用该证据，没有亲自执行此次 Electron 流程；原生确认返回值/失败受控，不计物理 OS 对话框交互、Windows 或完整正式验收。

本结论限本批宿主/worker/UI组合和上述实际执行场景。缺少其他平台或全量验收证据不在此冒称通过，也不将其作为已授权范围外的新代码缺陷。
