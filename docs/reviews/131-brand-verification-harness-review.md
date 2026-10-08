# 品牌改名验证 harness 独立审核

2026-10-08。审核人与本轮测试修复/打包验证实施人独立。本轮仅写本文，没有修改实现或测试。**当前静态与隔离单元范围通过，没有尚未修复的阻塞发现。** 全量组合、实际 ZIP 和旧安装包 → 新安装包的 macOS safeStorage 验证由主代理完成；本结论不将这些尚待主代理完成的项目标为通过。

## 范围

审核 `tests/helpers/main-function.ts`、`tests/unit/closed-work-lease-worker.test.ts`、`tests/unit/model-provider-alias.test.ts`、`tests/unit/desktop-recovery-bindings-review.test.ts`、`tests/integration/root-startup.test.ts`、`tests/packaging/package-archive.test.ts`、`scripts/smoke-brand.mjs`，以及追加修复的 `tests/integration/desktop-worker.test.ts`、`tests/integration/local-work-images-review.test.ts`、`tests/integration/workspaces.test.ts`。另外只读比对历史临时源码与 Git HEAD，以及历史包中的实际编译文件；没有再次启动旧包、读取作者默认根或作者 Key。

## P1：历史包只隔离 bootstrap、仍使用作者默认数据根

审核初始历史包时发现：第一处 `isolatedRoot` 已去除 `!app.isPackaged`，但 `launch()` 的 `dataRoot` 仍受该条件限制。因此 packaged 模式可以使用临时 userData，同时让真实 worker 打开默认 `.xuanxiang`。旧 smoke 仅确认 userData 和环境变量字符串，无法证明业务数据根隔离。审核即时通知主代理停止旧包启动。

主代理随后通知该准备进程已退出 1 并关闭，且曾写入合成模型和固定测试草稿；主代理已执行精确 CAS 撤销和保留其他数据的检查，事件及清理证据由其另行记录。本审核未访问默认根，不能独立证明清理结果；**此前那次准备不得计作隔离或原生升级验证通过**。

最终修复复核：

- `/private/tmp/xaanink-historical-build-i_3d3_k0/desktop/main/index.ts` 对 `git show HEAD:desktop/main/index.ts` 恰好两处差异：55 行去除 `isolatedRoot` 的 packaged 条件；192 行改为 `dataRoot = isolatedRoot ?? join(homedir(), ".xuanxiang")`。原名称、safeStorage、ready 顺序和业务入口均未修改。
- 历史 `dist/main/index.cjs` 与历史 `.app/Contents/Resources/app/dist/main/index.cjs` 实际 SHA-256 相同：`7e7d69f500780d1a294f7a0d13670ce8fb78a382e9bc3f62d21ffe34f6aca11a`。两处隔离表达式都存在，新的 harness preflight 正则对实际包字节都通过。
- `smoke-brand.mjs:33–39` 在启动历史包前要求显式 `--legacy-app` 与 `--packaged` 一致，并检查 bootstrap 与 worker 两处隔离表达式，不再只检查环境变量字面量。启动传递两家族测试环境变量。
- `smoke-brand.mjs:48–49` 在任何合成 settings/draft 写入前精确验证 `bootstrap().dataRoot === root`。升级和新建测试也验证实际 worker 根。新包实际 main 文件的 `XAANINK_TEST_ROOT` 不受 packaged 条件限制，进入 `selectBrandStartupPaths` 的 isolated 分支，再从选择结果设置 `dataRoot`；与此前 129 通过的路径选择逻辑一致。

静态预检和写前实际根断言共同覆盖本次遗漏。实际包也必须包含修复后的编译字节；只改临时源码或只核对 userData 均不足以重新运行准备。

## 测试修复是否保留原目标

| 变更 | 独立审核结论 |
| --- | --- |
| main-function 正常关闭依赖默认值 | 继续提取并执行当前 main 的真实 AST `businessHandle`，补齐普通关闭流程引用的 `workLease`、两种 exports 生命周期依赖。测试显式注入同名参数仍覆盖默认值；现有 gate/顺序/取消断言没有移除。 |
| closed-work-lease-worker | 给 worker 依赖夹具补只读 `protectedDirectories`；仍执行当前实际 RPC callback，仍拒绝未关闭、关闭进行中、关闭失败、重开和 lookup 期间撤销的目标授权。 |
| model-provider-alias | Qwen 夹具不再强行配置该 model 不支持的 low/high。合法 capabilities 输入后仍比较别名和 canonical 的 SDK/providerOptions，保留 provider、endpoint、公开 snapshot 和显式 Anthropic protocol 断言。这是别名等价测试，不将同一 helper 派生输入充当 capabilities 表的独立验收。 |
| desktop-recovery-bindings | 现在执行真实 `installBusinessSources` 注册闭包及两个真实回调。部分注册失败用新的 bootstrap 闭包，符合单次安装的幂等生命周期；仍保留六类 source 注册/解绑、真实 store revision、重复注册错误及原 sentinel 保留断言，没有把失败变成 no-op 通过。 |
| root-startup | 新建根产物使用当前 marker，迁移 inventory 读取相同实际文件。ROOT11-02/07 只将完整场景超时从 60s 调为 180s，真实 worker 的 `Atomics.wait(...25_000)` 未变，错误 pointer/journal 和禁止默认空库断言保留。`xaanink-core-after.log` 中 ROOT11-02 实际 60000ms 超时；后续 `xaanink-core-final.log` 同场景通过且耗时 62179ms，支持扩大整场景预算。ROOT11-07 before 也超时，after/final 分别 50580/40199ms；不是移除启动边界。 |
| package-archive | 仅更新 ZIP/App/executable 名称，仍用真实 `unzip -tqq` CRC、JSZip 原始 UTF-8 条目、完整 manifest 文件表和五个关键文件真实字节 SHA 对比，截断 ZIP 负例保留。不能以目录检查替代最终 ZIP 用例。 |
| desktop-worker 追加修复 | 非法 body `novelId` 现在明确断言严格 schema 返回 400 且未创建模板；再用合法 body 发真实保存并断言 201。query 参数仍保留，继续检查不重定向全局模板。修复原夹具错误，并增加真实拒绝断言。 |
| local-work-images 追加修复 | 写 build 证据前创建其目录，不跳过私有实际 worker 构建；新建作品读取当前 marker。原图片持久化、跨作品隔离和冷重启读取流程未变。 |
| workspaces 追加修复 | 先用合法 migrations 暖起真实 inbox，满足创建 reservation 的依赖，再仅对目标新 work 注入实际 `INVALID SQL` migration。明确断言真实 syntax error 和 `phase=creating` marker；合法冷重启后同 request 保留原 work id、数据库仅一作品及无关 author.txt 字节。没有模拟 engine、吞掉错误或删除恢复断言。另一个 inbox 初始化失败再恢复用例仍使用原故障 migrations。 |

`smoke-brand.mjs` 保持历史 `xuanxiang://app/`、原 `玄香印` 名称与真实 packaged 启动，先形成真实 safeStorage 密文和持久草稿，再由新包检查解密、公开状态无明文 Key、scheme 变化后的草稿恢复。fresh 检查真实 macOS 菜单、sandbox、无模型/无样例作品、关于界面及截图。通过报告仅在全部断言和退出完成后生成；fixture path 约束临时前缀及精确 legacy-data 子路径。失败时 finally 关闭进程。该脚本不是完整业务组或 Windows 验收。

## 实际验证与证据边界

独立使用 Node.js 24.18.0 执行三项变更的单元组，以及所有 `mainFunction` 消费者，命令：

```sh
PATH=/Users/dt_flys/.nvm/versions/node/v24.18.0/bin:$PATH node --import tsx --test --test-concurrency=1 tests/unit/closed-work-lease-worker.test.ts tests/unit/model-provider-alias.test.ts tests/unit/desktop-recovery-bindings-review.test.ts tests/unit/bootstrap-close.test.ts tests/unit/bootstrap-main-review.test.ts tests/unit/clipboard-ipc.test.ts tests/unit/close-ipc-review.test.ts tests/unit/configuration-files-review.test.ts tests/unit/draft-ipc-review.test.ts tests/unit/draft-ipc.test.ts tests/unit/profile-ipc.test.ts
```

实际结果 **52/52 pass，0 fail，0 cancel，0 skip，退出 0**；原日志 `/private/tmp/xaanink-131-harness-review-unit.log`。审核范围 `git diff --check` 退出 0。

只读检查主代理原日志：before 为 1578 tests、1551 pass、22 fail、5 cancelled；上一组合为 1618 tests、1615 pass、3 fail、0 skip。三项失败分别为非法 body 被预期为 201、证据目录不存在、故障 inbox 在目标创建前失败所以缺少 marker。追加三文件定向修复日志 `/private/tmp/xaanink-core-three-repairs.log` 为 **13/13 pass，0 fail/cancel/skip**，含上述真实目标。这是主代理执行结果，本审核没有以这些定向结果宣称最终全量通过。

旧开发 Electron → 新 packaged fixture 的 crypto 失败不等于旧 packaged 升级结论；真实安装包升级仍待主代理新一轮隔离运行。此前误写事件的修复也不替代该原生结果。实际 ZIP 成品结果、最终全量组合与 native screenshots/hash 应由主代理记录其本次执行和对应产物后验收。

## 审核版本 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `tests/helpers/main-function.ts` | `2b669bc7bc77e34276043fd87e4942dd53540d5046090ef2d188f7fd0042d6ce` |
| `tests/unit/closed-work-lease-worker.test.ts` | `8348c9c5ed3ccac4491e89564c89525fac411af92520bbc2d3a406cb512c268e` |
| `tests/unit/model-provider-alias.test.ts` | `2ef900d91aec9845c4d9d51f6a3c13d9e0bdf13e548c1be556270ff3801618cb` |
| `tests/unit/desktop-recovery-bindings-review.test.ts` | `c838ed782e22c007b88bd127fd5d401bd4e1f1deddf64e787ab9c4ad0f31b379` |
| `tests/integration/root-startup.test.ts` | `4b38a97b137ddb13d0eda363dc87961f109a870cef07916d51d0ad4fed5baea4` |
| `tests/packaging/package-archive.test.ts` | `26a34e218789e7047be843477672b8523b89bc3f1112abdf1467a2edf8643789` |
| `scripts/smoke-brand.mjs` | `5b5214c61153f9d6697ae866b9af8e824102a93ebe4b784c33dcf5dc6231c679` |
| `tests/integration/desktop-worker.test.ts` | `47bb65f627a61562a6fe413eb5fdfa23ca7212e41276335e4804eb68cfcdda61` |
| `tests/integration/local-work-images-review.test.ts` | `5dd19001ddc10743e21042dcd881f8462ccd086cdbc1d48f27244e0b155c16dd` |
| `tests/integration/workspaces.test.ts` | `cf03af59b59969069fad3b92029caf7d9d50053e11f877e43220a2bf9fcf0de5` |
