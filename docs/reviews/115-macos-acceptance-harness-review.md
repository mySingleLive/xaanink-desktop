# 115 · macOS安装版验收harness代码审核

2026-10-08。结论：**PASS_LIMITED_MACOS_ACCEPTANCE_HARNESS_CODE**。最终脚本当前无本次限定范围内的代码阻断，可以开始阶段41的有限执行。该结论仅审核原样安装包的启动身份核验、只读诊断、截图和生产 `app.quit` 收束；不授任何真实macOS操作、保存可靠性、完整N41-01或530条正式用例PASS。

审核者未运行此脚本、启动Electron、执行PG、访问两个用户数据目录或修改实现源码。仅定向阅读仓库脚本、114方案及安装的Playwright源码，并计算这些仓库文件的散列。作者报告的 `node --check` 成功属于作者证据，本审核没有将其写成独立执行结果。

## 固定审核对象

| 对象 | SHA256 |
| --- | --- |
| 最终 `scripts/acceptance-packaged-macos.mjs` | `9a1597bdc7036aa29868069a267bfc633c13b4c398f943ce3a3ebf3a170fbcf5` |
| `docs/evidence/implementation-41-native-plan.md` | `f3240518953ba4651cbb3c72625ecf54ec03eaf940ff352e89860e8a1b822189` |
| `docs/reviews/114-macos-native-plan-review.md` | `38f6691a00328061ca42a3a727121ba3f5b88e6f565bd57bca79de80c5ac29b7` |
| `implementation-39/user-test-data-authorization.json` | `3787e161fbeb240b9006823d75d39ae0d05e4f5a195dd435cfb979fded7e91df` |
| `implementation-39/packaging-frozen-v2.json` | `1c86395e8c758c7e21a9c90fb06c0b4b185d46498019e8cde356d1396ac2aa87` |
| `release/package-static-darwin-arm64.json` | `f6e10db57b6ec1d3786d644ea119896a71003bdb5251e4697329b770b4ee118c` |

用户已经直接确认默认业务根与userData仅含测试数据、没有真实Key；本轮允许使用已有测试环境。历史“目录不存在”观察不再作fresh-only条件，也不授权删除、备份、重置或真实模型收费。

## 静态发现与修复读回

以下是本审核的静态代码发现及修复读回，不是运行攻击用例的RED/GREEN，不补造测试成绩。初始脚本散列为 `8787a51d9158298d2d06e19ec24111e5ceae66d4ae38b4252b3a260848d20614`；第一轮三项修复读回版本为 `0584566710133002931690c0fa52eebcb24bf41aede81e41ab31dc7bc2683534`。

| 发现 | 最终读回 | 状态 |
| --- | --- | --- |
| 初版只比较Mach-O与可变manifest，JS/资源改变仍可能称原样包 | 钉死冻结v2 SHA；manifest SHA必须属于冻结产物；实际App所有文件/符号链接的路径集合及逐项SHA/解析目标均比对 | 已修复 |
| quit期限放在无界dispatch之后；status/bootstrap没有操作期限 | 45秒总期限在dispatch前建立，dispatch独立5秒；主进程诊断/公开bootstrap各10秒；截图10秒，启动/首窗口/加载45秒，验包90秒 | 已修复 |
| watchdog或未知退出后stdin循环可能仍存活 | 对实际返回的child handle钉住600秒timer；异常退出与watchdog关闭input并暂停stdin，记error及非零退出，强止只作用该owned child | 已修复 |
| 已请求quit后的非零码/信号退出也可能被计正常 | 实际child exit才设置 `cleanNormalExit`，且须请求正常退出、code为0、无signal、未强止；其它退出均记error及非零harness退出，quit不以单独 `exited:true` 通过 | 已修复 |
| 顶层保存失败可能跳过quit；pageerror的异步save rejection可能直接终止harness | 顶层save失败捕获后仍进入quit；exit/watchdog/pageerror的save均有rejection处理，pageerror设置非零退出；写证据按promise队列串行 | 已修复 |

最终补充已读回：启动前只读检查实际 `data-root.json` 中 `root.path` 必须为用户确认的默认业务根；status再核实际公开bootstrap根相同、所有窗口sandbox为true。审核者未执行这些用户目录检查，结果须由本次运行记录。

## 生命周期与实际依赖边界

脚本从冻结App的真实可执行文件启动，不传测试根、不改HOME、不注入测试preload。启动后读实际 `app.isPackaged`、0.1.0版本、App路径、默认userData和窗口；等待真实账户菜单，核页面为 `xaanink://app/`。只读bootstrap输出根、主题和模型数量，不输出模型Key。

已核安装的 `node_modules/playwright-core/lib/coreBundle.js` 中Electron launch实现：传自定义 `executablePath` 时直接启动该可执行文件；只有未传时才加入 `-r server/electron/loader.js`。Playwright本身仍加入Node/Chromium调试参数，因此运行时应区分harness调试通道与产品HTTP/DB监听，不能宣称无任何调试监听。包字节未改与“没有调试参数”是两个不同事实。

同一已安装源码中，launch初始化失败的catch调用内部kill；若launch未返回application/child handle，harness仅记录该库行为及无法独立确认具体PID退出，不填独立退出PASS、不接管未知实例。本审核没有运行launch失败路径，库源码保证不能替代本次实际退出证据。

正常收束调用真实生产 `app.quit`，未用 `app.exit` 或强止代替生产关闭流程。45秒仍未退出保留失败、数据和watchdog；600秒强止记forced/error，不能转为正常通过。实际child exit为退出判据，窗口消失、quit已发送或Promise返回都不是判据。进程句柄钉本次launch，watchdog不按扫描得到的陌生PID终止已有实例。每次新启动仍须新登记PID与新watchdog。

证据保存失败已不能通过已发现的rejection路径跳过App收束；落盘本身仍依赖实际文件系统可用性，不能将缺失/不完整证据计成PASS。此次没有做故障注入或证明磁盘/所有IO绝不会挂起。

## 本批仍须单独执行的验收

- harness只提供diagnostic `status`、截图、正常quit；业务写入不通过evaluate或私有IPC执行。主代理已明确UI动作使用获准CUA；若电脑控制工具拒绝，保留系统菜单/窗控/选择器未验收，不用OS脚本或stub替代。真实renderer locator操作若另行使用，仍区分注入键盘与物理IME。
- 当前脚本没有独立完成全程远程资源/请求失败收集、OS子进程表和应用监听归属检查；N41-01仍须另取实际证据，不能以首页账户按钮出现覆盖字体、Monaco worker、离线资源和服务监听全部断言。启动早于pageerror订阅的错误也不能被该订阅证明不存在。
- `cleanNormalExit:true`只表示该次退出满足限定分类；harness退出码0不能单独授整批通过。须读取完整 `state.errors`、dispatch错误、各命令错误及实际UI断言；保留任何失败历史。命令错误目前记录进errors，仍可继续独立检查，不能把后续正常退出覆盖前一次诊断失败。
- 正常退出不等于已证明保存完成。N41-08必须核本批新书/新章节/新会话归属、真实持久回执、旧PID结束，再由新PID读回同内容。既有草稿不得清空，设置按114记录原值并在正常完成后用同一UI恢复；取消/未知状态不盲回滚。
- 不删除已有测试数据，不创建产品备份，不发真实供应商调用；未签名开发包、macx64、Windows、fresh-install、故障迁移及剩余正式用例均保持各自未执行状态。

本报告可作为有限harness代码前置审核。任何脚本或冻结产物变化均需重新核相应范围；实际macOS结果按本次运行证据单列，不继承本报告的代码PASS。
