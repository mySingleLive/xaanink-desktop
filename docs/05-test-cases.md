# 正式测试用例与执行约定

<!-- USER-2026-10-08-CANCEL-BACKUPS CURRENT-SCOPE BEGIN -->
> **当前范围（2026-10-08）：用户取消全部备份功能。** 历史531条原文/状态保留；当前530条有效（桌面106+业务424），全部not-run。DESK-D08整条退役；B07/S08/G03/D05/ADAPTER-08五条混合用例只退役备份片段，D06澄清迁移恢复和旧控制安全拒绝。执行器按active scope选择case并应用activeDefinition；退役不计passed/skip，活动用例的全部平台/分支仍须验收。
> 活动清单：[acceptance-active-scope.json](acceptance-active-scope.json)；原文和退役明细：[backup-scope-retirement.json](backup-scope-retirement.json)。此处不声明实现完成或验收通过。
<!-- USER-2026-10-08-CANCEL-BACKUPS CURRENT-SCOPE END -->

版本1.0；日期2026-10-07。前置：技术方案及实施边界已通过独立审核23/24。**正式用例已通过独立审核25/26，全部531条尚未执行**，不得把UI原型历史检查计入App结果。

## 用例组成与追踪

- 桌面逐项场景：`05-desktop-test-cases.md` / `test-cases-desktop.json`。91条用户桌面/复用要求，各有真实操作，再加适配器、IPC、网络、真实供应商、全量组件对照等16条，共107条。
- 业务迁移：`05-business-test-cases.md` / `test-cases-business.json`。按完整29面板、98工具、保留API方法、65服务54模型与X01–X11展开，共424条，不以Tab显示替代业务操作。
- `requirements-traceability.json`及`migration-map.json`把每条需求/来源条目绑定用例ID。用例可共享领域fixture，但每个原能力有独立成功/拒绝/失败语义及可核对证据。清单完整检查不等于用例通过。

所有步骤列出的分支、菜单动作、绑定、Tab、平台与架构分别记子结果；整条用例只有全部适用分支通过才能通过。比如W08的五个菜单及其全部动作、K02运行时Monaco目录每个动作，不能用列表中出现名字代替执行。运行时增加命令生成有稳定commandId的子用例，与动作可用条件/fixture配对；依赖特定编辑状态的动作先建立该状态，不把disabled当通过。

命令子用例契约见 `command-test-contract.json`：每个运行时ID都要具体fixture/setup/invoke/observable assertions，不接受模糊名称匹配后通用“成功”断言。缺映射或未知动作记blocked并阻断总例；格式/选区/查找/折叠/剪贴板/AI/窗口分别观察文本、位置、可见范围、真实请求或OS状态。列表成员和run()返回不算通过。非Markdown适用项保留明确理由及独立审核。

## 隔离前置

自动化在临时目录创建独立bootstrap/root/workA/workB及测试profile，不读真实 `.xuanxiang`、原Web.env或作者作品。测试Key为公开fixture字符串；mock监听器仅测试进程启动，不打入安装包。Fixtures通过本地真实服务/事务创建完整关联，不把隐藏状态注入UI当作用户操作。版本冲突/故障注入需要记录触发点及数据前后散列。

模拟模型覆盖OpenAI Chat/Responses、Anthropic Messages、Google原生及各预设差异、完整目录分页、文本/工具/SSE、图像、认证错误/限流/迟到/取消。只证明协议和边界。LIVE-01/02需要作者通过App输入其Key并明确调用预算；未提供时标待验收，不能用mock替代。

## 分层执行

1. **TDD单元/数据库契约**：每批先写行为测试使缺失行为真实RED（不是未安装依赖/语法失败），实现GREEN后重构；保存命令、commit、失败原因与通过日志。先完成PGlite adapter真实类型/事务/回滚/超时、文件原子性、迁移journal、快捷键规范化及授权撤销。
2. **本地集成**：真实磁盘、每作品数据库、原领域服务及IPC contract；检查跨作品、幂等/候选/定稿/评论、重启持久化。每原API方法应在本地handler验证相同语义，不启动原Web服务。
3. **真实组件与Electron**：安装包内原React工作台，真实点击、键盘、输入、拖动、滚轮及关闭重开；同fixture与Web基线逐面板/两主题比较。所有设置配置和菜单项实际执行并验证副作用，不复制design/desktop-preview的状态。
4. **目标系统验收**：macOS arm64、macOS x64、Windows x64各自产物/系统记录。系统菜单、交通灯/WCO/吸附、原生选择器、剪贴板、IME/非美式布局、About、Dock、DPI与文件权限用真实系统操作。Windows风格预览、跨平台单元测试或交叉打包不能代替。
5. **独立安装/离线与恢复**：干净机器无Node/数据库服务启动；所有字体/图标/Monaco本地可用；不监听HTTP/DB端口，不访问平台。kill/重启、迁移各阶段失败、备份篡改、丢失根和损坏候选均验证。

为重复验收而编写的自动化脚本可以驱动真实Electron；主代理与用户共享的桌面操作按当前Computer Use工具规则执行。不能用合成DOM事件或直接改store代替原生输入命中证明。

## 结果格式与完成门

每次结果包含 `caseId / subcase / platform / arch / packageHash / sourceCommit / startedAt / status / evidence[] / observed / issue`。状态仅`not-run/running/passed/failed/blocked`；被跳过、缺环境、缺凭据都不能passed。公开证据需移除Key、实际作者路径、正文及私人资料，保留构造fixture的可复现内容。

独立子代理审核测试设计是否充分；实现之后再次独立code review。修复后重跑受影响用例，并记录先前失败，不用重置状态隐藏问题。验收汇总计算所有适用子结果，报告明确列未运行/失败/阻断。只有所有最终用例及目标系统真实验收通过，才能写“App已完成/验收通过”；否则只报告阶段进展并继续解决剩余任务。
