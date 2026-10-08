# 首次启动数据根与 Chromium 会话顺序独立审核

审核日期：2026-10-07（Asia/Shanghai）。定向范围为 `desktop/main/index.ts` 的 launch/启动失败出口、`desktop/service/index.ts` 的 ready/notifyStartup，及必要的 Workspaces 初始化、RPC 信号依赖。不扩展审查其余 IPC、模型路由或 UI 实现。

**结论：通过（本轮首次启动修复的限定范围）。** 没有发现新的有证据阻断项。当前顺序在首个 await 前等待独立 worker 完成迁移资源校验、数据根认领、inbox 初始化和原提示词 seed；仅成功信号才创建 session 并设置 sessionData。同步屏障成功/失败已通过真实构建 worker 的定向回归，不需要主进程事件循环参与初始化。

未修改实现。按委派授权只在 `tests/integration/desktop-worker.test.ts` 增加两项启动信号回归，并写本审核记录。真实 Electron 的旧故障由主代理复现，修复后的原生 UI 操作由主代理执行；本审核者没有操作 Electron 窗口或浏览器，不把 Node worker 检查称为原生 Electron 验收。

## 顺序与死锁检查

1. bootstrap/userData 使用稳定目录，位于数据根之外；requestSingleInstanceLock 成功后才进入 launch。数据根迁移不改变实例锁目录，本轮没有移动这项保护。
2. launch 创建 SharedArrayBuffer、独立 Worker、RpcPeer 和错误/退出监听后，直接 Atomics.wait，直到此处没有 await。屏障仅发生在任何应用窗口创建前；45秒是有界失败出口，不会在 UI 交互期间使用同步等待。
3. worker 的 ready 执行 Workspaces.initialize，再打开 inbox、完成原上游迁移和 local-author 初始化，随后 upsert 原提示词。初始化阶段没有 model RPC 依赖。worker 自己的 Node 事件循环、文件 IO、WASM/数据库运行不需要等待主线程处理 message。
4. 成功/失败处理器分别写入1/2，然后 Atomics.notify。store 在 notify 前，main 的 wait 也能处理 worker 已提前完成而返回 not-equal 的情况；main 随后重新 Atomics.load，无丢失唤醒窗口。本轮仅有单个 worker 写入一次终态。
5. 只有状态1才 mkdirSync(session) 并 app.setPath(sessionData)。两项操作仍在首个 await 前。随后 await ready RPC，再 await app.whenReady；模型仓库、权限/协议处理及 BrowserWindow 均在其后。
6. 状态2不创建数据根 session，ready RPC 返回原初始化错误，进入统一启动失败出口。worker 加载前崩溃或无法通知时，main 45秒超时退出当前启动，未进入 session 创建分支。正常错误/退出事件在主线程恢复处理后 dispose RPC，拒绝未完成请求。

该判断结合了源码顺序与真实独立 worker 行为。它不以同步屏障模拟整个 Electron 内部 Chromium 的工作；“首个 await 前正确设置 sessionData 是否解决实际 Electron 行为”仍以主代理的原生复现和修复回归为证据。

## 数据与失败边界

Workspaces 仍在创建权威 marker/catalog 前加载并校验迁移资源；未认领的非空数据根仍拒绝，没有为容纳 Chromium session 而放宽成可接受任意非空目录。此次修复把 Chromium 创建 session 的时点移到数据根已认领之后，保留了原非空目录保护。

已有 owned 数据根仍走原 marker/catalog/inbox 校验；没有通过清空目录、删除已有作品或重建缺失已 ready 数据库来解决启动。ready 失败不会把信号误置为成功，也不会在失败根添加 session。两项失败场景实际检查作者文件原始字节和完整目录条目，原文件没有改变。

45秒到期属于启动失败，不等于后台数据库已优雅关闭或部分初始化已全部回滚；这条路径没有成功 UI，也不宣称崩溃恢复完成。进程退出后的锁恢复、启动中断恢复和慢设备极端耗时，需要对应的后续故障/原生验收；本轮不通过删除锁或跳过数据验证掩盖这些情况。本次没有实际耗尽 main 的45秒期限，结论只包括有界等待及失败分支的源码核查。

## 新增独立验证

```sh
node --import tsx --test tests/integration/desktop-worker.test.ts
```

使用 Node24.19.0，先构建实际分发 worker，3/3通过，无失败、跳过或取消：

- 原 IPC-01 回归仍通过：实际 worker 执行原 handlers、目录作品创建/读取、归属和全局模板 scope。
- 新增成功启动信号用例：测试主线程同步 Atomics.wait 期间真实 worker 完成初始化并写入1；确认 owned marker phase=ready/inboxReady=true、catalog为空、真实 PG_VERSION 存在、ready RPC成功、原提示词实际已 seed。主进程回调计数为0，证明这条初始化链没有依赖正在阻塞的主线程 model RPC。
- 新增失败启动信号用例：分别测试有效迁移资源下的未认领非空目录、缺迁移资源的目录，worker 写入2且 ready RPC返回对应原错误。两者都只保留原 author.txt，其字节完全一致，没有新 marker/catalog/inbox/session。

单次屏障测试等待分别限制在20秒/10秒，主线程之外的 worker 独立完成；不是依赖轮询或先 await ready 再检查共享值。测试退出时 dispose RPC、终止隔离 worker并清理临时目录，未读取/删除真实作者数据。

新增测试及其静态依赖的窄 TypeScript 检查通过（退出码0）。临时配置继承 tsconfig.foundation，显式使用仓库的 @types，检查后清理。构建实际 main/service/preload 通过，但 esbuild 构建不等同于全量 App 类型检查。

## 验收边界

本记录仅确认启动屏障、数据根保护、初始化独立性及失败信号，不证明安装包、所有首次启动故障、真实目录对话框或全部创作功能已验收。`native-smoke.json` 自身限定为 darwin/arm64 的 development Electron bootstrap 检查；即使 macOS 原生首次启动通过，也不能据此宣称 Windows 原生首次启动、窗口行为或全量用例通过。正式验收状态不由本审核推进。
