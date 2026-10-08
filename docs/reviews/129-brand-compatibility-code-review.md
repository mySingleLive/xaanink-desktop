# 玄印写作数据兼容与启动独立代码审核

2026-10-08。审核人与兼容实现人独立；本轮只写本文，没有修改实现。兼容实现人已冻结代码，最终结论：**通过本范围审核，没有尚未修复的阻塞问题**。先前发现的两项 P1 和一项 P2 均已修复并独立复验。

## 范围与最终版本

审核 `desktop/shared/brand-names.ts`、`desktop/core/brand-names.ts`，以及本次涉及的 Workspaces/storage/lease、应用备份/关闭源/迁移/重定位/ownership/export 兼容调用；审核父实现 `desktop/main/brand-startup-paths.ts`、`desktop/main/index.ts`、`src/lib/chat-session.ts`。追加审核 writer authority 的 `desktop/service/database/pglite-adapter.ts` 修复。没有重复 SVG 资产审核。

最终源码 SHA-256（由 Node.js crypto 对实际文件计算）：

| 文件 | SHA-256 |
| --- | --- |
| `desktop/core/brand-names.ts` | `e3ef269308a70b5658d46b498cccbdfae1b9ab778f8a63e74d91d12f6bb9c283` |
| `desktop/shared/brand-names.ts` | `4a2def5076b9af5baf824e28d31df5fc49d0e9ba474d6366ff40631e0ac02dae` |
| `desktop/service/workspaces.ts` | `cbae265a5873e1995c8b795474326be90802212f53ea5f7985953dfef77bcb11` |
| `desktop/service/database/pglite-adapter.ts` | `067258d92ae71af6043de730add651a1de25e60e9e3ea51df4c7fd29960cd2cb` |
| `desktop/main/brand-startup-paths.ts` | `7b3b62145710eb99a1711267d5c160da80bedf0471581580fe214696a8c052e1` |
| `desktop/main/index.ts` | `c224f1862e4d5681310ac49598c6b561430f2fca8ae9658b1e729443e705f917` |
| `src/lib/chat-session.ts` | `50e0474156a3d9602debdde8fc034f6c63549f73cd55c50048b192b3f56e00b7` |

兼容实现通知的三个冻结哈希（core reader、Workspaces、adapter）与本次计算相同。

## 发现与修复复核

### P1：连接复用与后台客户端未持续拒绝异家族控制

初始实现只在连接建立时校验 manifest 和控制文件，`Workspaces.run` 复用已持有的 slot 后直接执行业务回调。独立真实 PGlite 复现：创建 current 作品，运行一次以保留连接，新增异家族 audit，再调用 `works.run(... prisma.novel.update ...)`，写入成功。

审核用独立脚本 `/private/tmp/xaanink-brand-review-run.mts` 的初始结果：

```json
{"nextWrite":"WRITE_ACCEPTED","controlPreserved":true}
```

已修复：`workspaces.ts:282` 组合固定目录/marker observation、异家族控制及 writer lease；`workspaces.ts:349` 每次业务回调前校验；`workspaces.ts:301` 将同一 authority 注入真实 Prisma adapter，使捕获 database client 的保留后台任务也校验。inbox 合法更新 `inboxReady` 后刷新 observation，仍严格核对应用 id、app 值和 ready 状态。inbox engine/assets 的路径使用固定 canonical directory（`workspaces.ts:286`），独立 flush/close 不依赖后来可能变化的父目录别名。

原独立脚本修复后结果：

```json
{"nextWrite":"WRITE_REJECTED:BRAND_CONTROL_CONFLICT","controlPreserved":true}
```

独立审核并执行追加用例：BDC08 捕获真实 database client 并保留任务，退出 run 后新增 foreign audit 再放行实际写入；两家族都拒绝，原 title 保留。BDC08 还验证事务先写、随后 foreign audit 到达、提交拒绝，已写语句实际回滚，后续事务可继续使用同一 engine。

进一步独立审核 BDC09：真实 PGlite 显式事务占有 engine queue，普通语句在通过初步 guard 后排队；foreign audit 到达后释放前事务，排队语句必须拒绝。最终 adapter 在实际取得 queue 的事务回调内及提交前重新校验（`pglite-adapter.ts:32`），显式事务在入口、语句和最终 commit 边界校验。guard 失败会回滚；rollback/dispose 不受 guard 阻断；同一结束操作保留幂等性。BDC09 与既有 adapter 生命周期组均实际通过。

### P1：APFS 大小写等价的 foreign lock 被漏检

初始 `assertBrandControls` 对 readdir 的 entry 使用精确大小写比较。本机临时目录实际验证：`.XUANXIANG-LOCK` 与 `.xuanxiang-lock` 解析到同一目录，但 current manifest reader 仍接受该根，因此可漏掉实际存在的第二家族锁。

独立脚本 `/private/tmp/xaanink-brand-review-case.mts` 的初始结果：

```json
{"filesystemResolvesLowercaseLock":true,"readerResult":"current","entries":[".XUANXIANG-LOCK","xaanink-work.json"]}
```

已修复：`desktop/core/brand-names.ts:39` 先 case-fold 全部 entry，再检查另一家族控制名称和临时文件前后缀。BRN04 追加两家族的 uppercase storage/required/audit/lock/restores/temp 用例，仍验证原目录内容不变。原独立脚本修复后返回 `readerResult:"BRAND_CONTROL_CONFLICT"`，实际 APFS 小写路径仍解析到原锁。

### P2：有效首次初始化状态被品牌选择器阻断

初始默认根分支要求 `inboxReady=true`。独立真实 Workspaces 初始化产生合法 `phase=ready,inboxReady=false` 后，普通路径选择器返回 `BRAND_DEFAULT_INVALID` 且无 recoveryPaths，原有 initializer 无法继续。与此同时原 `DataRootManager.resolve` 正确返回 needs-initialize，继续运行真实 inbox 初始化可完成。

独立脚本 `/private/tmp/xaanink-brand-review-initialization.mts` 已确认该差异。修复后默认根保持严格 paired brand 与 ready 阶段检查，允许原 inbox initializer 完成，仍保留已有 inbox 数据缺失/不完整时拒绝重建的保护。pointer 分支仍核对完整 ready/inboxReady/id。

原独立脚本复验：选择器返回原 bootstrap/root/current family，`DataRootManager.resolve` 仍返回 needs-initialize，真实 PGlite 初始化结果 `existingInitializerResumes:true`，退出 0。追加 BSP09 覆盖两家族同一原目录的真实初始化、pointer 发布、关闭和重开，实际通过。

## 其他审核结论

- 命名表冻结且没有全局可变 family。reader 依据真实唯一 marker 选择家族，只读，不通过写文件猜测或修复；严格 filename/app 配对、root 与 marker device/inode/revision、原字节、单链接普通文件、无竞争家族检查均保留。同步 `assertCurrent()` 不把新 inode 或同 inode 内容变更当成原观察。
- 新建作品显式 CURRENT_NAMES；打开旧作品、旧 storage-required/candidate、锁及 audit 沿用旧家族，生产 `WorkLeaseHandoff` 注入 `namesForWork:workNames`。inbox 恢复使用真实 app marker 家族；最终 unlink/rmdir 前仍同步重验原 owner/lock/audit proof，live/foreign/unknown owner 不因此被授权恢复。
- root journal 从原 stage/migrationId 派生命名，校验其 app marker 家族一致、recovery 名称一致；没有重写旧 journal schema 或 checksum 语义。ownership、closed-root inventory、重定位、应用 restore 和导出保护识别两家族；工作目录/lease 内部路径不纳入应用文件清单。
- startup 选择保持原 bootstrap 与 userData/单实例锁，严格校验 pointer root；坏旧数据不回退创建新空根。selection error 带 recoveryPaths 时先路由既有 relocation/maintenance（`index.ts:684`），普通 worker 的 launch 仍拒绝 selection error。显式测试隔离不读取宿主目录。
- `index.ts:60` 在 ready 前使用持久 app marker 家族选择加密身份，ready 后恢复「玄印写作」显示名。此处只审核调用顺序及选择逻辑；真实 macOS safeStorage 跨进程兼容、生产封包和平台 UI 证据由主代理另行验收。
- chat session 先读取新 key，缺失时读取同一 storage 下的旧 key；新保存只写新 key；坏新记录不退回旧记录或被覆盖；清除同时删除两 key。桌面跨 scheme 的持久草稿仍走原 DraftJournal 恢复流程，不能将这两个单元用例视为真实浏览器 origin 升级验收。

主代理反馈开发版旧 Electron fixture → 新 packaged 包的密文解密失败，正在换成实际旧 packaged → 新 packaged 验证。本次另外只读提取本机 Electron 44.6.0 的 `default_app.asar/main.js`：开发入口先 await import package.json（95 行），再设置 package productName/name（110–115 行），最终 await import 项目入口（133 行）。它支持开发入口与 packaged CJS 入口时序不同的推断，但不能据此确定已创建的 Keychain service/account 身份，亦不能把开发 fixture 失败写成安装版兼容通过。重建旧包时旧 HEAD 的测试环境变量受 `!app.isPackaged` 限制，需显式隔离测试入口/补丁，保留原名称初始化和 safeStorage 生命周期并记录差异，防止旧包进入作者默认数据根。

## 独立实际验证

使用 Node.js 24.18.0，独立执行：

```sh
PATH=/Users/dt_flys/.nvm/versions/node/v24.18.0/bin:$PATH node --import tsx --test --test-concurrency=1 tests/unit/brand-names.test.ts tests/unit/brand-startup-paths.test.ts tests/unit/brand-chat-session.test.ts tests/integration/brand-data-compatibility.test.ts
PATH=/Users/dt_flys/.nvm/versions/node/v24.18.0/bin:$PATH node --import tsx --test --test-concurrency=1 tests/integration/pglite-adapter.test.ts
```

- 品牌/兼容/session：37 tests，37 pass，0 fail，0 skip，退出 0；包括 BDC08、BDC09、BSP09。原日志 `/private/tmp/xaanink-129-brand-review-tests.log`。
- 既有真实 adapter：12 tests，12 pass，0 fail，0 skip，退出 0；包括隔离、并发阻塞、超时回滚、dispose 和结束幂等。原日志 `/private/tmp/xaanink-129-adapter-review-tests.log`。
- 上述三个原独立复现脚本均在修复后重新执行，结果见对应章节；全部夹具位于隔离临时目录并 finally 清理，没有读取作者作品或 Key。
- 审核范围 `git diff --check` 退出 0。

最后 inbox canonical path 一行已逐行复核；其真实 chat/conversation 回归 11/11 和基础安全组 87/87 为实施者执行结果，详见 127，本文不冒称为审核人另行执行。主代理仍需按既定流程完成全部活动核心检查、最终生产构建/封包、真实目标系统和 safeStorage 兼容验收；本文的通过不覆盖这些尚待主代理验收的范围。
