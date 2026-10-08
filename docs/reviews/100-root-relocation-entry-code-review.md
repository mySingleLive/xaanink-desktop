# 第 100 轮独立代码审核：原根失联重新定位入口

日期：2026-10-08。作者 `/root/product_revision_review`（第 33 批入口、只读保留 hook 与菜单）及 `/root`（main 首同步路由）；审核者 `/root/ui_revision_review`。结论：**限定范围 PASS**。两项独立重启竞争 RED 与主代理原生发现的同文档导航 RED 均已修复、复验；本轮无未关闭阻断项。

## 范围与身份

审核 RootRelocationController/preflight/隔离窗口与 restricted preload、RootRelocationScreen/Home，以及只读 getter 新增完整 journal/completion proof、DataRoot/startOwnedRoot/maintenance 的精确保留 hook、main 首同步启动分流。包括批准合同要求的系统菜单、固定 Windows popup 与主 frame 权限。本审核者未修改生产源码或作者断言。

第 31 批原定位提交、旧第 29 批迁移库存是历史依赖；本轮审核其新增只读 proof 与保留接线，不把旧冻结自动扩展为新行为通过。第 17、24、27 批部分间接依赖由本审核者编写，不独立自审这些旧实现。小目录 fixture 中 PG_VERSION/数据库占位字节只证明文件身份，不证明实际 PGlite 健康。

## 独立行为与修复

原七项 `tests/unit/root-relocation-100-review.test.ts` 使用真实隔离 FS、原 DirectoryAuthority/Core31/controller/request/runner；窗口测试打包实际模块，Electron 边界受控。新增两项 `tests/unit/root-relocation-navigation-100-review.test.ts` 不改原七项或其冻结 SHA。

| 编号 | 可观察要求、原结果与复验 | 结论 |
| --- | --- | --- |
| RL100-01 | 实际提交与 fresh getter 后，complete observer 同步改写外部 pointer；旧自动 restart 仍进入 host。现每次实际重启重读精确提交 proof，在最后按钮发布后同步核验 owner/ticket/控制记录，失效不重启、canRestart=false，外部字节保留。 | 独立真实 RED → GREEN。 |
| RL100-02 | 显示完整结果后把 ledger 中同 request/receipt ID 的 outcome 改成不同内容；原 reader 拒绝 RECORD_CHANGED，实际磁盘外部记录完整，continue 未调用。 | 首次 GREEN 守卫。 |
| RL100-03 | 首次有效提交后 host process handoff 受控失败；随后 pointer 改写，旧显式 retry 又进入 host。现 retry 重新证明本次提交，失效不得复用缓存授权，外部字节保留。 | 独立真实 RED → GREEN。 |
| RL100-04 | 主 frame 新文档导航立即撤旧 bridge；晚到 picker 物理完成前不 quit，完成后 quit 一次、不 commit/relaunch，原 pointer 保持。 | 首次 GREEN。 |
| RL100-05 | 已存在外部持久 session 窗口时，冷定位入口在创建维护窗口/IPC/菜单前拒绝。 | 首次 GREEN。 |
| RL100-06 | macOS 实际模块生成固定六组菜单及 About/version/Edit roles；业务项禁用。CmdQ、关闭共享 pending-picker drain；过期 owner 的 About/minimize 不转移权限。 | 首次 GREEN；菜单与 Electron 为受控边界。 |
| RL100-07 | Windows 分支固定五组 popup，绑定精确窗口/main frame；renderer 模板、任意路径对象、子 frame、导航后的旧 frame 拒绝。 | 首次 GREEN；macOS FS 上受控 platform，不是 Windows 验收。 |
| RL100-08 | 保存的 v1 模块在现代同文档事件上撤 owner，state 读取实际 UNTRUSTED；原生还会使用 legacy isInPlace。v2 显式 isSameDocument 优先、缺失才取 legacy，strict true 保留同一根 URL 的 bridge，两种事件均不退出。 | 主代理 native 实际 RED；独立旧版 1 FAIL/1 PASS → 原断言 GREEN。 |
| RL100-09 | 显式 isSameDocument=false 优先 legacy true；unknown 主文档也撤权。pending picker 完成前不退出，完成后 quit 一次，未写 pointer/receipt、未 relaunch。 | 首次 GREEN；保留安全拒绝。 |

RL100-01/03 修复同时经作者 RE33-15 的最后发布 observer 变更 pointer RED 验证。紧贴实际 app.relaunch 的受信闭包前无后置 await；提交后失效只保留已经发生的提交事实，不伪造回滚。

导航限制须精确理解：同文档事件保留 owner 解决同 URL hydration 误退出；IPC 仍严格要求 senderFrame.url 为 `xaanink://app/`。非根 path/query/fragment 不获得 bridge 权限。本审核未把事件 owner 保留扩大为任意 history 地址可读 IPC。作者已确认此边界，v2 历史合同不回写。

## 启动、历史结果与界面接线

首次同步路由在业务 worker/session 创建前区分 none/lost/blocked，未知控制证据不被默认空根初始化覆盖。新窗口使用内存 partition、静态本地 UI、restricted preload、拒绝网络与新窗口，没有普通工作台 bridge。目录输入只来自 main 原生 picker/DirectoryAuthority，renderer 只接受语义命令和有限 readonly 状态。

新增 retention proof 绑定完整 journal canonical checksum 与精确 completion witnesses；recover/resolve 之后、首个 engine 初始化前重读并同步 seal。terminal pending 被保留时不执行清理或重写旧 journal。maintenance 显示与 ACK 不能只靠相同 ID/path：合法 ACK 后只接受原见证的精确子集；历史 source/target/outcome 保留，新「当前数据目录」独立显示。未知记录、权限丢失、异步尾窗被原行为用例覆盖。

UI 复用原 Button/语义 CSS，订阅先于 snapshot，拒绝坏状态与迟到 revision；取消/退出在 picker 处理中保持可调用，错误使用固定文案。macOS 顶级与原生文本/窗口角色保持；Windows 顶部图标仅发 menu 枚举，模板只由 main 生成。作者实际 React/Chromium 共 41 项通过属于作者证据，本审核没有重新运行这些浏览器用例或覆盖其截图。

## 运行、指纹与证据边界

独立最终运行 `review100-15-final-related-green.tap`：**84/84 PASS，exit 0，0 skipped/cancelled，4113.531417 ms**。构成为本轮独立 9 + 作者 entry 15/window 11/startup 10 + root main 4 + 原 Core31 29 + 旧独立 6；不与作者 union 138 或 React 41 相加。`review100-14-final-typecheck.txt` 为完整项目 tsc **exit 0、空诊断**。

历史证据原样保留：01 第二项是在安全拒绝后错误地用 pinned reader 再读外部记录，产生 oracle 错误；02 改用真实磁盘 JSON 后为 1 PASS/1 产品 RED；03 为 1 PASS/2 产品 RED；04 types 失败仅别批在途测试诊断；05/06/07 是修复及逐步守卫 GREEN。10 使用 SHA 匹配 v1 的实际窗口存档，1 FAIL/1 PASS，无缺模块/编译假 RED；11 为 84 GREEN；12 types 唯一错误是新增 esbuild harness 的 outputFiles 可选收窄，补显式断言后 14/15 最终通过，不算产品缺陷。

作者 v2 aggregate 为 `92f8c472019c3d80a43338da6de3e91f7dc7c817a1c4266c4f60a095619be650`。`review100-13-final-manifest-verification.json` 独立核 **133/133 SHA**、全部组 path:sha256 LF 聚合一致、base/-v2 同字节；改前 window 存档与 v1 对应 SHA 一致。主代理 `root-native-build-inputs-21.json` 的 **20/20** 构建/源观察匹配当前字节；新增独立两项另纳审核最终摘要，不回写作者历史冻结。

## 主代理原生附录

主代理执行的 run18 实际失败保留：第二次定位窗口在标题显示前关闭，checks 0。dist-only 诊断19记录 finish-load/ready-to-show 后同 URL legacy isInPlace=true 的 hydration 导航触发退出；它是诊断，未当验收。作者保存改前 source/test 并以原断言 RED44→GREEN45 修复；v1 冻结未覆盖。

修后真实 macOS arm64 开发运行使用无诊断插桩的 desktop build20/static17，run21 exit 0。`native-attempt-03/native-root-relocation.json` 为 **3 组 PASS、errors=[]**：实际旧窗口/进程退出后同 FS rename，restricted 定位页；取消和选择错误作品目录不改原数据；确认原 inode 后单 receipt、pointer revision+1，实际 app.relaunch 更换 PID，原作品/章节与未提交 composer 保留。系统 picker/确认返回值受控。本审核只读核 JSON、运行与版本记录并查看 unavailable/wrong-directory/reopened 三图：失联说明、错误重选及原工作台未提交输入均可见，长路径换行完整；未亲自操作 Electron 或系统菜单。

**限定 PASS 不包含**物理 OS picker、Windows 实机、真实键盘菜单行为、跨卷/复制根恢复、备份恢复激活、全业务健康/真实模型或全量发布验收。531 正式用例仍全部 not-run；本报告不改变其状态。
