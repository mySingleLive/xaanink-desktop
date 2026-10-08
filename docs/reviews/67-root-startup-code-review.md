# 67 · 权威数据根启动与主进程接线独立审核

日期：2026-10-08。审核者：product_revision_review。启动模块由 product_review 编写，主进程接线及 session helper 由 root 编写。审核者仅新增独立测试、证据和本记录，没有修改被审实现或作者测试。本人编写的第64轮迁移请求模块不在本轮独立 PASS 范围，它由第66轮另审。

## 范围与结论

**限定 PASS，本轮无剩余阻断项。** 发现的 RS67-01/P1 数据目录风险已实际修复并复测。审核者最终独立合跑 **36/36**，fail/cancelled/skipped/todo 均0、exit0；全项目 TypeScript 检查 exit0，无诊断。

本轮审核 service/root-startup、shared/root-startup、service/index 的 ready/notifyStartup 段；main/index 的稳定 bootstrap 规范化、单实例锁入口、launch 到 app.whenReady 前的初始化顺序；新增同步 session-directory helper。主进程后续 UI、模型请求、运行中迁移接线、关闭流程及 core 目录扩展不纳入本轮通过结论。

第63轮冻结清单的7份文件与其 aggregate 均已独立核对一致。main 仍有其它批次集成，以三个限定 AST 片段记录范围，不冻结整份 main。当前 DataRoot/ownership/Workspaces 等依赖 SHA 仅记录实际执行版本；第65轮 core 扩展另有独立审核，本轮不替代其结论。

## 实际缺陷与修复

|编号|严重程度|复现|修复与最终状态|
|---|---|---|---|
|RS67-01|P1|权威根和 marker 合法，但 root/session 是指向外部用户目录的 symlink。原 main 的 recursive mkdir 接受它并将 sessionData 指向该路径，授权 Chromium 在应用受管根以外写入。|main 改用同步 prepareSessionDirectory：先核对绝对 canonical root、普通目录和 dev/inode；非 recursive 创建 session；EEXIST 只接受普通真实目录；最后复核 root/session 身份，再 setPath。独立01/03/07/08通过，已关闭。|

独立01通过真实临时文件系统建立 symlink，并从当前 main 源提取 launch 前缀，绑定真实 helper 执行。最终在 setPath(sessionData) 前拒绝，外部用户文件字节及目录清单均保持。Electron 对象是受控 harness，未实际启动 Chromium，风险结论来自允许写入路径的错误授权，而非宣称已经在用户目录产生破坏。

`review67-02-session-safe-red.tap` 为6项中5PASS/1FAIL，唯一真实失败是 RS67-01。更早 `review67-01-session-root-red.tap` 为4PASS/2FAIL，其中独立04的 AST harness 漏取实际 bootstrap mkdir 语句，是审核测试夹具缺陷，已更正且保留旧日志，不计第二个产品缺陷。没有修改实现迎合该夹具。

## 启动与数据安全核对

稳定 bootstrap 在实例锁前规范化为 realpath，并设置 userData；锁失败直接 quit、不 launch。独立04运行实际源语句，证明 symlink appData 别名最终使用相同 canonical 锁目录。生产 main 必传 bootstrap 和64KiB barrier，不使用旧 fixture 兼容分支。

生产 worker 在任何 Workspaces/DB 打开前先 DataRoot.recover→resolve。不存在的权威根、损坏 pointer/journal 均阻断，不回退创建默认空库。独立05和10分别验证无指针时损坏历史 journal、校验和正确的 rolled-back 历史 journal，initialize 回调均未运行，另一个默认目录未生成，原数据与外部未知文件保留。prepared 请求不会被该启动模块作为迁移授权读取；本模块只恢复 core 已持久化 journal，不执行第64轮请求调度。

initialize 开始前即让 startupHost 的“从未开库” lease 失效。初始化、原模板 upsert 均成功后才 adopt 新指针；已有根再次核对完整 pointer。worker ready 的 catch 先 await 已打开 Workspaces 的 close 尝试，再发布固定失败。独立09运行实际 ready initializer，加真实 startOwnedRoot 与受控 seed/close gate，证实 seed 失败时 ready 仍等待 close、没有 adopt，错误不包含注入的 secret。此项是关闭顺序的受控证明；实际引擎初始化/重开另由8项 built-worker 验证，不能把受控 gate 称为真实 PGlite 异常关闭验收。

共享信号先写 payload/version/length，最后 atomic store status/notify；读取 pending 不读未发布内容。严格版本、保留字段、长度、UTF-8、状态一致性、绝对路径及固定错误白名单由原12项 unit 和独立06验证。失败代码重建，不传播原 Error message/cause。45秒有界等待仅发生在无窗口的首次启动；worker 初始化和 seed 不需要主线程处理模型 RPC，实际 built-worker 测试在主线程 Atomics.wait 时完成启动。timeout/损坏信号不生成 fallback，也不把失败解释为 ready。

main 在第一个 await 前取得 worker 验证的 canonical root，完成同步 session 检查并设置 sessionData，然后 await ready RPC 和 app.whenReady；作者3项实际源前缀测试验证顺序，独立01–04绑定真实文件系统/helper验证路径边界。session helper 拒绝消失根、root 别名、session symlink/普通文件；独立08真实替换 root inode 后拒绝继续授权，同时保留原 marker 与新目录中的未知文件。最终 syscall 间隙不能证明抵御任意外部恶意进程，生产仍依赖稳定实例锁与用户自有目录。

4字节且 bootstrap-free 的旧隔离 fixture 保留兼容行为；64KiB生产格式缺 bootstrap 必须阻断。作者 built-worker 最后8项和原 desktop-worker 3项真实编译 service entry 到 UUID 隔离输出，运行 PGlite/Prisma 与原迁移/模板，证明迁移后的原数据根可重开、坏根不新建、恢复已提交 journal 后仍开原库。构建输出清理，不覆盖 root 当前运行的 App 构建。

## 验证证据与限制

最终独立执行使用仓库 Node24：

```sh
node --import tsx --test --test-reporter=tap tests/unit/root-startup-review.test.ts tests/unit/root-startup.test.ts tests/unit/root-startup-main.test.ts tests/integration/root-startup.test.ts tests/integration/desktop-worker.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

`review67-04-full-related-green-attempt.tap` 为 **10独立+12作者unit+3main前缀+8实际built-worker+3原worker=36/36**；`review67-05-typecheck.txt` 为 full tsc exit0，无诊断。更早24项修复验证及所有 RED 保留，不累计旧执行量。`review67-final-manifest.json` 记录指纹、限定 main 源片段、测试与证据；生成脚本保留以便重复校验。

第63轮合同中的 setPath(join(root,session)) 示意不是当前 main 的安全实现；当前必须经过新增同步 helper，上述源片段及独立测试固定这一边界。第63轮历史16/17 typecheck的两个外部迁移请求类型错误保留；当前全项目类型检查已通过，未用旧日志抵扣。

root 提供的 `native-root-startup.json` 是额外的作者原生证据：macOS arm64 实际退出后，离线迁移1391文件/52目录，重启使用新指针/sessionData，原工作台可见，主题写入新根并跨第三次冷启动保留。本审核者没有操作 GUI，此证据不计入独立36项，也不证明设置迁移入口/进度、OS选择器或 Windows 已验收。

启动时的 startupHost 必须由调用者保证上一进程及 session 写入者已经退出，持有稳定实例锁，并未在任一候选根打开数据库/session；新 worker 本身不能证明其他写入者静默。运行中 arm/restart/请求关联与恢复结果 UI 仍须后续接线验证。本轮没有真实 Windows、断电、原生选择器、完整桌面用户验收，未更改531正式顶层测试状态。
