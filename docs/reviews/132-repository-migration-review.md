# GitHub 仓库迁移与许可证审核

日期：2026-10-08（Asia/Shanghai）。用户指定目标 `mySingleLive/xaanink-desktop`、主分支 `master`、许可证 GPL-3.0。

## 方案与独立审核

按用户最新要求，新仓库只接收当前项目快照，`master` 为没有父提交的单个初始提交，不上传原项目的提交历史、分支或标签；此要求覆盖此前保留提交历史的迁移方案。当前源码包含迁移前工作区内的品牌改名、兼容性实现及审核材料。旧历史留在本地 `codex/migration-history`，旧远端保留为 `previous-origin`；新 `origin` 指向目标仓库。

LICENSE 复用目标仓库已有的 GPLv3 标准全文；主分支为 `master`。项目元数据使用明确的 SPDX 标识 `GPL-3.0-only`，第三方和依赖的原许可证不变，项目版权声明保留在 README 和第三方声明的项目许可首句中。仅对新仓库 `master` 使用带明确预期远端 SHA 的 `--force-with-lease` 更新；远端发生新修改时停止覆盖。

独立子代理 `migration_review` 已审核迁移、许可修改的验证范围、测试用例和代码增量，结论均为通过，无阻断项；最新单提交快照方案与验证范围已另作独立审核并通过。检查当前候选文件后，未发现真实 Key、私钥、数据库或安装产物；命中仅为拒绝测试夹具。约 10.6 MB 的许可字体是正常项目资源。此检查不是对既有设计截图逐张 OCR 的声明。

## 本次实现范围

- `LICENSE`、README、第三方声明首句、package.json 和 package-lock 根项目许可更新。
- README、package.json、当前产品设计及设计元数据指向新仓库。
- 真实 `executeCommand` 的反馈入口指向新仓库；macOS 和 Windows About 显示 GPL-3.0，并继续使用 `app.getVersion()`。Windows About 调整间距以容纳许可行。
- `tests/unit/repository-license-commands.test.ts` 提取并执行真实命令函数，覆盖反馈地址、两平台许可和实际版本，以及关闭期间拒绝执行。

其余工作区内容是迁移前已有修改，本次仓库迁移审核没有重新宣称这些业务实现完成验收。

## 验证证据与边界

测试用例先执行得到 3 项预期失败（旧反馈 URL、macOS MIT、Windows 缺许可）及 1 项关闭 gate 通过；独立审核复现该结果后实施。

最终定向检查使用 Node.js `v24.18.0`：

```sh
node --import tsx --test tests/unit/repository-license-commands.test.ts tests/unit/command-menu.test.ts tests/unit/brand-product-identity.test.ts
```

结果为 11/11 通过；独立子代理复跑同组检查通过。`git diff --check` 通过，根项目 JSON 许可一致、依赖许可证未改。LICENSE 与目标初始化文件逐字节一致，SHA256 为 `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`。

GitHub 更名后，`git ls-remote --symref` 已确认 `HEAD` 指向 `refs/heads/master`。推送后核对远端 SHA、提交数为 1、提交没有父提交、远端分支和标签列表、工作区状态及许可证显示。现有源码除本记录外应与快照重建前完全一致。

上述定向测试控制原生依赖，不是 macOS/Windows 原生窗口验收，也不替代完整业务验收。本次不构建或上传安装包，不改变原有验收台账中的未完成状态。
