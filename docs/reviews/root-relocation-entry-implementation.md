# 第33批根失联入口作者交接（2026-10-08）

失联的原应用根在任何源 worker/session 打开前进入隔离维护窗口。合法失联才可选择同一物理目录并明确确认；损坏记录只诊断和退出。取消等待真实在途 IO，原指针/历史保持；提交后只经 fresh 完整证据冷重启。平台系统菜单、受限 Windows 菜单按钮、原 UI 的「当前数据目录」区分已落实，不复刻 Web 工作台。

作者实现：shared/main controller/preflight/window、独立 preload、RootRelocationScreen、Home 路由与 preload build entry；新增 readonly retention helper，31 getter 只读增量、DataRoot recover、startup 和 maintenance runner 的完整证据核验。main/index.ts 第一同步入口由 root 作者接线，单列 wiring snapshot；原31/29/72/73/98冻结不改。本批不自审或自授独立 PASS，review100 另由 ui_revision_review 执行。

作者新增36 Node（entry15/window11/startup10）和17真实 React（screen11/routing2/history4）。最终47日志实际138/138：作者36+原相关91+root main4+独立100最终7；42曾136/136（native guard之前），40曾134/134（独立当时5）。41日志实际41/41：作者17+原UI相关24。两个联合均0 skip/cancel，退出0。46全项目 tsc 真实退出0空诊断（43/39此前也0）。相关量是回归集合，不是新增179条最终产品用例，不把531任何未运行顶层用例改通过。

保留有意义 RED：07首次精确保留失败、11缺审计被普通路径误放、16真实旧Home优先级、17 resolve晚改 journal 开库、20关闭准入、25/26当前路径图示/runner、30最后重启通知 observer 改指针、32-platform-menu-behavior 两平台菜单；37使用准确逆向保存的改前组件证明 Windows 菜单缺失。100独立01/03发现 complete 发布后过期 proof 自动/显式重试，已每次重新 getter 并最后同步 seal 修复；独立原断言不改。

非产品 RED如实保留：13/14 routing shim 未规范 dynamic组件，33/35 Chromium sandbox MachPort 权限失败，36 controller outcome TS未收窄（显式 return fail 修），28相邻34在途三类型诊断，root-ui-build15在途verified TS诊断。09及 review72 首次回归为29 preserved终态语义变化/错误夹具字段，reviewer 校准保留原 unknown 文件/不重迁移/closure等 oracle，历史72报告不改。38实际菜单React11 GREEN、43全类型0替代这些失败时点；既有23曾全类型0但不代替后续运行。

运行命令以47/41清单为准：Node24 `--import tsx --test --test-reporter=tap` 的10文件联合；浏览器使用已安装 headless Chromium1228，五文件 actual React+CSS、全部网络阻断。没有启动可见 Electron、没有 PGlite 大库/真实模型 Key/付费服务、没有自行发布。实际Main/Electron picker/coldrelaunch、中文输入与Windows行为由 root 串行验收，不能由受控测试升格。

31只读 API 增量：`RootRelocationDisposition.journalChecksum/completionWitnesses/assertCurrent`。provider 从本次完整规范 journal 与 fresh receipt 当前链构造 retained authority，末次同步返回；合法 ACK 后重新 getter，历史 result.root 从不被改成新路径。missing/modified audit/完成记录失效保持原数据，旧 pending journal完整留存且仍阻断新的普通迁移。副本/跨卷、应用备份恢复与新迁移归档策略不属于33。

第33批 v2 原生联调修复：root 的实际 Electron hydration replaceState 触发 did-start-navigation，details 未提供 isSameDocument 但 legacy isInPlace=true，v1误撤 owner 后退出。19原生诊断保留；44作者受控模块same-document真实1FAIL/1PASS，修为 details.isSameDocument ?? isInPlace（明确details值优先），仅strict true保留已加载原文档。新文档或unknown主frame仍撤权限/drain/拒旧IPC，45=43/43。v1 manifest及精确改前window/test/generator保存，v2是新增源审核，不借v1通过称无问题。原生成功仍由root新attempt单列，本作者不复授OS验收。
