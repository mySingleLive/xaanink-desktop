# 61 · 主进程配置文件流程独立代码审核

日期：2026-10-08。审核者：product_revision_review。被审主进程实现由 root 编写；审核者未修改其实现或作者测试，仅新增独立行为测试及本记录。配置转移纯核心由审核者编写，已另由 product_review 在第58轮独立审核通过，不作为本轮自行复审通过的依据。

## 范围与结论

**限定 PASS，无剩余本轮阻断项。** 四个有实际行为 RED 的问题已修复。最终独立复跑作者9项、独立18项、ModelRepository11项和 VersionedStore7项，共 **45/45**，fail/cancelled/skipped/todo 均0；全项目 typecheck exit0，无诊断。受信快捷键目录的只读验证也通过。

本轮审核 `desktop/main/configuration-files.ts`、`desktop/shared/configuration.ts`，以及 VersionedStore.update、ModelRepository.commit/updateSettings 新增同步 beforeCommit 守卫。主进程仅扩审 ConfigurationFiles 构造选项、desktop:configuration IPC、trusted、closeData、releaseOwner 与内部 protected-directories 目录来源；preload 仅审 configuration 转发。未将其它 main/UI 代码、原生选择器或完整桌面集成纳入 PASS。

## 实际发现与修复

|编号|严重程度|实际复现|修复与最终状态|
|---|---|---|---|
|CF61-01|P2|选择器 Promise 永久等待时，cancelWindow 虽取消 owner，flush 仍一直等待选择器，阻塞 closeData。|仅选择器业务等待与 stopped Promise 竞争，取消后业务槽可结束，迟到路径不能继续读取/写入。真实文件写入仍由 pending 跟踪，flush 必须等其结束。独立01/06/13/15通过，已关闭。|
|CF61-02|P1|用户通过原生导出选择器选中正在使用的 state.json，便携配置覆盖应用仓库格式，丢失原配置/凭据容器结构。|仓库暴露只读 path，导出始终拒绝其 canonical 路径；主进程额外注入当前应用根、bootstrap 与所有已登记作品目录，初次写入和最终 rename 都复核。现有目标/父目录被替换或改写时保留用户文件。独立02/07/08/09通过，已关闭。|
|CF61-03|P2|持正确 token 调用 apply，owner 校验失败发生在原 try/finally 之前；恢复到原 owner 后旧 token 又可应用，形成 owner ABA 重放。|active 捕获 owner 校验异常并立即 retire 当前 operation；取消、失败或成功提交后旧 token 均不再可用。独立03/10通过，已关闭。|
|CF61-11|P2|实际 main IPC 中 apply 已完成 rename、正在等待目录 sync；frame/session 更换后，原 await 返回仍向现窗口发布配置/缩放并回旧请求。|IPC 捕获当前 window 与 draftSession 对象，preview/export/apply 的 await 之后重新校验 trusted、精确 window/session 所有权。迟到回复拒绝且不发布；已经 rename 的磁盘提交继续权威，不伪称回滚。实际源函数受控运行的独立11/14通过，已关闭。|

历史证据 `review61-01-first-boundaries-red.tap` 为4项中3个实际失败；`review61-03-main-reply-red.tap` 为11项中2个失败，其中只有 CF61-11 是新增实现缺陷。CF61-05 的原“任何失败都消费 token”断言与作者新增的 validation-only 修正重试契约不符，是审核测试旧 oracle。该日志保留，修正后的独立05验证：无写入的字段/冲突验证失败允许显式修正再试；renderer 修改返回 preview 不能替换 main 保留的 plan；成功后 token 消费。此项不计产品缺陷，也没有修改作者测试迎合结果。

## 独立验证的边界

独立01–10覆盖取消的迟到选择、live-state 保护、返回 plan 深拷贝隔离、临时文件写入后原 beforeRename hook 与新同步守卫的执行顺序、同 inode 改写、父目录替换、protectedRoots 动态变化和 owner 失效。所有文件在每例独有的真实临时目录中读写，没有使用用户配置或真实作品。

独立12证明 schema 无效时不执行守卫；守卫在原 hook 后同步执行；拒绝后原队列仍可按相同 base revision 成功提交下一项。独立13证明取消不能将真实 repository 写入从 flush 中摘除：挂起 directory-sync 时 flush 仍等待，释放 gate 后以已提交 revision 为准。beforeCommit 是同步校验接口，不支持把异步权限校验放到这个最后原子边界。

独立11/14–18通过 TypeScript AST 从当前实际 main/preload 代码提取限定函数或表达式，在受控 Electron 对象和真实 ConfigurationFiles/ModelRepository 上执行，覆盖：未受信 frame、额外原生路径参数、坏 UUID、跨设置 session token；closeData 先 cancel→flush→repository.read 再关闭 worker；原生选择闭包的旧窗口 nonce 迟到；releaseOwner 在释放当前草稿会话前取消配置操作；preload 只转发单一受限 IPC，不暴露 fs/shell/dialog API。受控 Electron 回调不是原生窗口/选择器验收。

源码定向核对还确认：导入仅接受绝对本地路径、普通非 symlink 文件、最大4MiB和严格UTF-8；open 的 no-follow、打开后身份、流读取长度、最终 inode/size/mtime/ctime复核均在主进程。导出拒绝非普通文件、symlink 与多链接目标，使用 atomicWrite 临时文件和最终目标/父目录身份复核。文件格式、CAS、冲突、授权引用处理复用第58轮核心和现有 ModelRepository；没有在 renderer 接收完整 plan、原生路径或目录定义后直接提交。

受信目录来自 `command-catalogs.generated.json`，由安装的编辑器与静态注册表生成，main 直接导入；导入文件和 renderer 不能定义目录。本轮运行 verifyCommandCatalogs，两个平台目录及10份源文件 hash 一致。生成器在两个受控浏览器平台环境枚举命令，不是两个真实操作系统的快捷键验收；本轮没有执行生成器或构建。

## 证据与范围限制

审核者最后实际执行：

```sh
node --import tsx --test --test-reporter=tap tests/unit/configuration-files-review.test.ts tests/unit/configuration-files.test.ts tests/unit/model-repository.test.ts tests/unit/versioned-store.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

使用仓库 Node24 运行时。最新 `review61-07-current-scope-green.tap` 为45/45，`review61-08-current-typecheck.txt` 对应 exit0 无诊断，`review61-09-catalog-verification.txt` 对应只读受信目录校验 exit0。先前45项/tsc日志与所有 RED 均保留，没有累加旧 GREEN 充当新的执行量。

`review61-final-manifest.json` 记录被审流程文件、测试、相关依赖与实际日志 SHA；仍在集成的 main/preload/worker 使用上述限定 AST 片段 SHA，而不是冻结整份文件或替未审函数背书。生成脚本保留以便重复核验。

本轮尚未操作 Electron、系统文件选择器、真实关闭窗口、UI diff确认/快捷键交互；未测试 Windows 文件 ID、替换或目录 sync，也未模拟 OS 断电。取消是业务权限失效，不代表已让系统对话框自动消失。文件系统的最终校验覆盖实际受控变更窗口，不承诺抵御外部恶意进程在最后 syscall 间隙的任意竞态。正式531顶层用例状态未改，本轮结果不能替代真实用户桌面验收。
