# 桌面退出基础独立代码审核

日期：2026-10-07。审核者 `/root/product_revision_review`；不修改本轮退出实现。

结论：**限定范围 PASS**。3项实际行为缺陷已由主代理修复，并通过审核者保留的原失败断言及新增竞态验证。本结论不包含仍在接入的 DesktopApp/layout 完整恢复流程，不等于 DESK-W11/W12 或完整 App 验收通过。

## 范围和证据

审核 `desktop/main/close-coordinator.ts`、`renderer-close-channel.ts`、`desktop/shared/close.ts`、`src/lib/desktop/draft-session.ts`、`src/stores/desktop.ts` 设置关闭屏障；限定阅读 main 的 CloseCoordinator 回调、关闭/退出/激活事件、close-reply/export handlers 及 preload 两条新增接口。另核对 `ModelService.activeCount/resume/close` 与 worker 的 task-status/stop-tasks/close 生命周期，不扩大业务处理器或完整恢复接线。

审核者首次运行作者5个单测文件为 **26/26**，证据 `53-author-unit-baseline.tap`。新增实际 CloseCoordinator/设置队列断言首次为2通过2失败，保留 `53-independent-first-red.tap`；worker 实际 RPC callback 在受控取消 IO 中的超时断言为0通过1失败，保留 `53-independent-stop-timeout-red.tap`。这些失败不是编译失败或未实现 mock 导致。

修复后9个文件合跑 **39/39**，0跳过/取消，证据 `docs/evidence/implementation-08/53-independent-final-green.tap`；组成是作者26项和审核者新增13项。全项目 `tsc --noEmit --incremental false` exit0，输出见 `53-independent-typecheck.txt`。没有把旧531条正式用例状态改为通过。

本轮没有启动 Electron、原生对话框或重建产物。main/worker callback 由当前 TypeScript AST 提取后执行，IO/native dialog 为受控依赖；模型超时测试使用真实 ModelService/ModelGateway/ModelRepository 和隔离磁盘，网络为可注入挂起 fetch；导出测试使用实际 main handler、校验和 atomicWrite，文件在临时目录。它们证明限定逻辑与磁盘行为，不能代替真实窗口事件。

作者 `worker-reopen-green.tap` 中3项 built-worker 检查含关闭后重开断言。本审核读取其证据但未重新执行，因此不计入39项，也不声称覆盖本次更新后的完整 worker 构建。

## 发现与关闭情况

| 标识 | 严重度 | 实际证据及影响 | 修复及复核 |
| --- | --- | --- | --- |
| C53-01 | P1，平台验收阻断 | commit(window) 同步触发 request(quit) 时，后者共享已提交 window 的 flight，Promise返回true却从未 commit(quit)。对应 Windows 最后窗口关闭同步触发 window-all-closed/app.quit/before-quit 的接线，原后置请求晋级丢失。 | 已关闭。协调器在同步 commit 后处理 quit 晋级；main Windows 关闭入口直接选 quit，关闭期间 Dock activate 不创建新窗口。原断言GREEN；新增 C53-01b 证明 commit过程中新owner出现时不关闭新稿。未做真实Windows验证。 |
| C53-04 | P2 | 设置 bootstrap 尚未就绪时 update 拒绝，但检查位于catch外，error仍null；flushDesktopSettings错误返回成功。 | 已关闭。初始化/bridge检查进入catch，失败状态被保留，fallback bootstrap读取也允许缺失bridge。原失败断言GREEN，saving恢复0且关闭屏障仍拒绝。 |
| C53-05 | P2，退出恢复阻断 | worker原8秒截止点在 await response.cancel/pendingStarts之后才建立；取消IO永不settle时一分钟后仍pending，尚未进入renderer20秒回执等待。main同样先无界等待 model.close/workerstop。重复关闭共享永久flight。 | 已关闭。worker整个停止等待外包8秒timer，main整个model/worker停止等待外包10秒timer；超时不关闭DB、不释放未settle任务租约。停止捕获原pendingStarts，结束后禁继续轮询。新增 C53-05b 与 C53-06 验证迟到旧stop不作用于新任务，超时退出可取消并resume，新模型请求在旧close最终完成后仍可执行。 |

## 已核对的行为

重复 window/quit 请求共享一个关闭流程；保存失败重试保留原owner，已经确认停止后不重复停止。新owner/nonce在保存、关库或同步commit期间出现时，不提交该新owner。生成确认取消不停止、不保存、不关闭。失败导出、取消原生保存选择以及导出后再取消关闭，均不构成丢弃许可或commit。

renderer先等设置队列，再等原AutosaveController真实完成，再等主进程journal回执；main通过journal.confirm核对实际持久记录，最后等待数据库关闭才提交窗口/应用关闭。取消只中止本次等待，仍在执行的编辑器保存与数据库租约不被伪造为完成。释放会话移除来源和writer；读取/恢复失败不安装替代writer覆盖旧记录。

RendererCloseChannel只接受当前owner、session和本次UUID token，匹配flush/export动作；错误reply、重复reply、过期token及timeout后的迟到reply均不能释放另一关闭请求。超时/同步send失败会清pending和timer，允许下一次请求。

新增 `close-ipc-review.test.ts` 的5项核对实际 main handler：旧nonce和动作错配不ACK；原生导出取消不写入；rename前owner变化保留原文件并清理自己创建的temporary；symlink目标拒绝且作者文件不变；目录sync失败不返回成功，已rename的恢复数据作为未确认文件保留。导出只产生不执行的恢复快照，不提交正文、发送任务或批准候选。

ModelService停止时拒绝新调用，cancel仍跟踪未settle的原transfer；失败关闭resume及macOS新窗口resume都允许随后请求。旧close完成没有尾部重置服务状态，独立gate验证不会重新暂停已resume的服务。worker重开与Workspaces已有保留租约约定一致；真实macOS Dock/Windows进程退出仍待平台证据。

## 明确边界

本轮验证了停止等待和renderer回执的有界超时；没有证明任意操作系统磁盘调用或所有worker RPC都不会挂起。原生保存选择、Electron同步事件顺序、窗口销毁/崩溃、打包后恢复、自动保存与布局完整接线，以及目标Windows/macOS架构验收仍需后续执行。当前恢复UI作者和主代理仍在集成，未将其计为PASS。

独立新增文件：`tests/unit/close-coordinator-review.test.ts`、`settings-close-review.test.ts`、`close-task-timeout-review.test.ts`、`close-ipc-review.test.ts`。确切命令、文件及限定main片段指纹另存 `docs/evidence/implementation-08/53-independent-manifest.json`；main其余在途改动不冻结为本轮已审。
