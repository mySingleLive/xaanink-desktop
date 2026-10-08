# 玄印写作品牌改名组合验证

2026-10-08。最终中文全名「玄印写作」、简称「玄印」、英文名「XaanInk」。本次改名、编译、封包和 macOS arm64 启动已完成；所有活动单元/集成测试及打包检查通过。实现、用例和独立审核见 121–129，验证 harness 收尾独立审核见 131。用户选择旧数据兼容、新数据使用新名称。

## 最终结果

| 检查 | 实际结果 |
| --- | --- |
| 原生产构建 `npm run build` | exit 0，Next.js 静态导出、Prisma 与 Electron 三个入口完成；最终兼容修复后增量 `npm run build:desktop` exit 0。 |
| 完整 `npm run typecheck` | exit 0，Node 24.18.0；最后一次包含全部修正的测试夹具。 |
| 完整活动核心 | `node --import tsx --test --test-concurrency=2 tests/unit/*.test.ts tests/integration/*.test.ts`：1618 tests，1618 pass，0 fail/cancel/skip，342598 ms，exit 0。 |
| 实际新名称 ZIP 与资源组 | `npm run test:package`：14/14 pass，0 fail/cancel/skip；完整 unzip CRC、UTF-8 路径、27011 条包文件表、关键文件字节、截断负例、314 项应用资源与原生图标校验通过。 |
| 原生旧安装包 → 新安装包 | `node scripts/smoke-brand.mjs --packaged`：exit 0；真实旧 safeStorage 假凭证可解密，公开状态无 Key；原 DraftJournal 的草稿在实际 scheme 变化后恢复。 |
| 新安装实际应用 | 原生新 marker 为 XaanInk；无默认模型、无示例作品；真实菜单为玄印/文件/编辑/视图/窗口/帮助，关于玄印写作、退出玄印；sandbox=true，原工作台离线协议加载，无 renderer pageerror。 |
| 用户可见启动 | 最终 `.app` 在新隔离目录保持运行。CUA 实际观察窗口「玄印写作」、`xaanink://app/` 和上述六组系统菜单；主进程只读 lsof 检查无 TCP LISTEN。 |
| 文件检查 | `git diff --check` exit 0。 |

原始最终日志分别为 `/private/tmp/xaanink-core-final2.log`、`xaanink-typecheck-last.log`、`xaanink-package-tests-final2.log`、`xaanink-native-brand-final.log`。本机脱敏摘要/日志、源码 hash 与截图保存在 `docs/evidence/brand-rename/`：`verification.json`、`native-brand.json`、`legacy-fixture-build.json`、`core-final.log`、`package-final.log`、`native-upgrade.png` 和 `native-current-about.png`。证据目录按仓库现有规则不公开提交；没有作者数据或真实 Key 进入证据。

当前应用目录为 `release/mac-arm64/玄印写作.app`，bundle ID 为 `ink.xaanink.desktop`，版本 0.1.0。ZIP 为 `release/XaanInk-0.1.0-mac-arm64.zip`，350257126 bytes，SHA-256：

```
8e626805fbe756adc78afa45da582980c9d7d41bde0781e9e524e32b7adea7a1
```

本次产物未签名、未公证、未发布；没有将旧 DMG 当作新品牌产物。

## 兼容和名称边界

产品标题、菜单、关于、导出元数据、协议、npm/安装包名称与真实矢量字标已改新名称。18 套 SVG 的原图形 group 保持，horizontal/formal 使用许可字体的实际新字标 path；原无字图形继续作为 ICNS/ICO 来源，独立资产审核见 126/128。

旧 app/work marker、storage、租约、恢复 audit 和历史迁移控制按权威 marker 家族继续读取，不重命名原目录或改写 checksum。新作品、新安装根、新导出使用 XaanInk。损坏旧状态、双 marker 或异家族控制不会静默创建空新库。原加密名称只作为已有安装数据的 OS 兼容身份保留，初始化完成后显示新名称。来源仓库链接和原始历史检查 JSON/截图保留事实，不把过去的界面证据改成当前品牌验证。上游 Web 仓库未修改。

## 测试修复与失误记录

改动前的真实基线为 1578 项：1551 pass、22 fail、5 cancel；不能宣称基线全绿。首轮组合还暴露父路径别名、连接复用与后台写入 guard 缺口；127/129 记录了真实 RED、修复和独立复验。同步当前 AST、依赖与严格输入的测试夹具后，上一组合为1618项中的1615 pass/3 fail；剩余三项都是基线已有夹具问题。真实模板非法 body 拒绝、图片构建证据目录、目标作品实际 SQL 迁移失败重试修正后定向13/13通过，最后整组1618/1618通过。131独立审核确认没有删除安全断言或用模拟 engine 代替真实行为。

原生升级最初采用开发 Electron 形成假密文，再交给安装包；真实解密失败。这没有被标作旧安装版兼容通过。实际 default_app 的异步外部入口与安装包 CJS 生命周期不同；随后改用 Git HEAD 原码构建真实旧安装包，保留其原早期名称与 safeStorage 行为。

旧包准备的第一次隔离修正只覆盖 bootstrap，漏掉 worker 的 packaged 路径条件，造成合成测试模型和固定草稿写入默认目录；该轮超时失败并正常关闭，明确不计作隔离验收。独立131审核发现第二处条件后，主代理用目录身份、原文件字节 CAS、无锁条件和原 schema/checksum 校验，精确移除一个唯一合成模型和两处固定合成草稿文本；清理时验证其他设置、其他模型及其他草稿来源保持原值，不删除默认根，不输出其内容或 Key。无法将此事件描述为从未触及默认目录。

修正后的旧临时源码与 `git show HEAD:desktop/main/index.ts` 恰好只有两处显式测试隔离表达式差异：bootstrap 和 worker 都使用同一测试根。实际旧包 compiled main 与临时 dist 的 SHA-256 相同，两个隔离分支由启动前静态检查验证；所有设置/草稿写入前还核对实际 `bootstrap().dataRoot === isolatedRoot`。该安全版本重新准备并正常退出，再运行新包的真实升级与新安装检查，均exit 0。相关最终证据不包含前述失败轮。131记录了独立字节比对及修复审核。

## 台账和验收范围

`docs/requirements-traceability.json` 与 `docs/migration-map.json` 新增品牌改名记录，链接实际实现、用例和本次证据；没有修改既有正式业务用例的 status/evidence。完整活动核心与此次原生品牌升级通过，不代表106桌面+424业务正式用例整体通过。Windows/macOS x64、真实供应商和完整业务验收仍未执行；旧浏览器组的备份退役夹具问题也不被本次核心通过覆盖。没有提交、推送或发布代码/安装包。
