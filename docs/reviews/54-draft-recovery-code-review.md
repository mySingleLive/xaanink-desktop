# Renderer 草稿恢复独立代码审核

- 日期：2026-10-07。
- 审核者：独立子代理 `/root/ui_revision_review`，不是本批实现作者。
- 结论：**限定范围通过（PASS）**。两项实际行为缺陷修复后，独立执行7个相关Node文件44/44通过，完整项目类型检查退出0。没有未关闭的本批阻断项。主进程journal、DraftSession/IPC/DesktopApp、实际布局桥及原生恢复验收不在本结论内，所有531条正式用例仍保持既有not-run状态。
- 范围：作者冻结的7个源码：`draft-recovery.ts`、`workspace-draft-source.ts`、`comment-draft-source.ts`、`disabled-session-caches.ts`、原 `comment-drafts.ts` 与其组件窄接线、原 `tabs.ts` 的同源runtime类型目录。保留作者5个测试文件；本审核新增两个文件9项行为测试，不修改实现或作者测试，没有运行Electron。

## 发现及修复

| 问题 | 实际失败与后果 | 修复与独立复验 |
| --- | --- | --- |
| REC54-01 · P1 | 聊天分支读取owned缓存后，后续workspace目标校验仍在等待；此时同一key写入较新的聊天输入。最终commit使用之前组装的值，覆盖新缓存。 | 本审核用实际恢复函数及ChatSessionRepository写入复现。commit再次读取同一owned key，比较捕获的完整原字节；变化时不写缓存、不计applied，将旧incoming完整保留为CURRENT_DRAFT_CONFLICT。新输入保持原字节，旧稿仍可导出。 |
| REC54-D02 · P2 | 关闭恢复，空正文只含显式旧模型/思考/模式时，meaningful判断漏掉这些意图。存储被播种为空会话，内存仍保留旧选择，第二份journal的active又包含旧模型和plan。 | 作者源码自检先提出可疑冷缓存场景，本审核落实际RED证明。捕获与重置覆盖模型、effort、两个explicit标志、mode、作品及创建位置/编号等元数据。存储与内存共用一个freshChat身份；旧选择先归档，清后没有自动补默认模型。 |

`54-independent-recovery-red.tap`实际6项4通过2失败，两失败正是上表；修复后没有修改这6项行为断言。其余3项独立守卫首次执行为GREEN，没有虚构RED。

两份早期 `.log` 保留了夹具错误：tsx的CJS模式不支持顶层await；隔离持久化夹具最初未提供Zustand默认使用的window.localStorage；坏评论字节按原实现备份是允许的附加写入，不能要求所有写入都为零。这些不是产品缺陷，也不混入RED计数。

## 恢复数据及副作用边界

恢复函数只把校验后的数据应用到原store；没有可调用的保存闭包、运输层、模型API、定时重试、confirm、markSent或批准入口。独立测试拦截网络，保留chat原队列action、显式null模型与plan意图；pendingRequest完整body/请求编号进入recovery，活动记录清pendingRequest并保留wasRunning提示。scene的imageRequests/submissions只归档，没有注入活动请求消费者；未知autosave不能伪装成controller执行。原use-agent-chat源码的恢复路径暂停队列，本审核只定向核对该边界，没有把其真实挂载或队列UI当作已验收。

staged恢复复用原schema和路由匹配，核对kind/op/作品/目标/白名单路径、editing或chipped及chip对应关系；保留旧baseline、operationId、phase和revertNonce，没有自动发送。scene保留正文、图像提示词与旧版本，冲突的新输入优先。未知或不可读数据留副本，不猜测目标身份；未提供或失联的受信只读校验器不授权恢复实体。

评论复用原账号store、完整key、目标/锚点/线程及时间戳；错误账号或key不规范化成当前目标。原坏评论/聊天字节不覆盖；评论原实现允许把坏字节另存备份，本审核明确保留这个行为。原Web评论身份/不同账号分仓两项移植断言通过，未运行其写数据库的原套件。

workspace复用原29种TAB_TYPES、buildTabId和SettingType，候选额外保留parent chapterId；恢复不触发离开守卫或panelFocus。layout经schema校验，等待原adapter注册；无有效tab时不能应用内容可见布局。作者Node测试验证pending/adapter生命周期和旧disposer隔离，不证明真实Group/Panel首帧与尺寸。

所有来源在最终应用前检查Abort。独立测试让chat已准备commit，再阻塞workspace验证，取消后立即拒绝；较晚的true回执不能写chat、修改tab或污染已有recovery副本。只读校验器是否实际具备作品归属约束仍需接线方证明，本批不以返回true的替身当数据库归属验收。

## 禁用恢复时的双检查点协议

捕获只访问owned chat/comment key及对应原store，没有枚举sessionStorage、清理陌生key或执行旧操作。当前账号scene数据通过其原Zustand持久适配清理，其他账号的条目保留；staged、workspace和聊天的当前数据先归档。损坏评论来源的临时quarantine仅在捕获字节及内存指纹仍匹配时允许完整归档，不放宽普通不可读来源的写入门禁。

调用者须先完成包含旧缓存和recovery副本的 `checkpointDrafts` 持久ACK，再调用 `afterCheckpoint`，随后再完成新状态的第二个检查点，之后才开放编辑。`afterCheckpoint`是运行时闭包，不进入快照；它没有主进程回执凭证，不能自行证明调用方已持久写成功。本审核用受控writer验证这个调用顺序，实际DesktopApp/IPC/main接线另审。

独立测试在writer等待时证明聊天、评论sessionStorage和原scene的localStorage字节不变；ACK后只清owned缓存，第二份快照仍包含可导出的旧副本。第二份active使用新会话与清空后的选择，不恢复旧显式模型。当前宿主的Abort、指纹变化或晚到新输入禁止清理；scene写入期间新增输入会令整批清理拒绝，聊天/评论原缓存也不先清掉。

首个writer拒绝时，调用链没有进入清理，原缓存与内存均保留。部分存储写失败，已完成阶段幂等、未完成阶段可由同一实例重试；完整旧副本始终保留，外部账号字节不变。本批没有证明存储写入是fsync；校验的是内存ACK协议与原Zustand适配行为。

## 独立执行证据

文件位于 `docs/evidence/implementation-08/`：

- `54-independent-recovery-red.tap`：6项实际4通过2失败，0跳过/取消，退出1。
- `54-independent-review-fixes-green.tap`：两个独立文件9/9通过，0跳过/取消，退出0。
- `54-final-related-independent-green.tap`：7文件**44/44通过，退出0**，含作者33项新行为、2项原Web评论断言、9项独立行为。作者先前35或41项、50/52及其他阶段的数量均不累加。
- `54-final-independent-typecheck.txt`：全项目 `tsc --noEmit --incremental false --pretty false` **退出0**，空诊断。
- `54-independent-summary.json`：最终受审文件、测试和日志指纹及冻结核验结果。

独立缓存测试在import原store前提供隔离window.localStorage，执行真实Zustand persist序列化；sessionStorage、主进程writer ACK和verifyTarget是受控替身。测试不访问用户缓存、磁盘日志、真实数据库、模型或网络，不运行GUI。

最终 `draft-recovery-frozen.json` v3包含7源码、5作者测试和2独立测试，共14文件。全部文件SHA及有序聚合独立核对匹配，聚合为 `42b42ca28f58bdc20acc39a030a5d1d0c3c96bdcb720dd2fad58e7c666b19e1c`。算法为有序 `path:sha256` 以LF连接并包含最终LF；v1/v2修前记录保留，不混用。

## 后续接线必须证明的行为

本批没有实现或验收main journal fsync、IPC会话代数/CAS、DraftSession的初始化/取消/关闭握手、DesktopApp的双ACK调用、真实布局桥、恢复提示与查看/导出入口、实际重启/崩溃、Dock或Windows退出。接线方必须先读旧journal并完成恢复/归档，再安装writer与业务UI；任一ACK失败不得清理或开放可覆写旧稿的页面。

restore关闭时未知、损坏或不可读数据仍应可保留/导出，不能通过强制空快照绕过writer门禁。目标查询只读且校验真实作品归属；恢复草稿不能当保存授权、作者批准、默认模型补位或旧请求重放授权。上述实际副作用与两平台场景必须在各自审核及正式用例中另行证明。
