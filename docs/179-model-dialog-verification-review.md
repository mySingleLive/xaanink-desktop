# 配置模型修复最终独立验收审核

日期：2026-10-09。范围：173/175 定义的内置公开候选和 API Key 剪贴板两个问题，共 18 个用例。仅新增本审核文件；未改实现、用例、证据或台账，未读取实际 Key/用户剪贴板，未执行供应商接口，未重复操作用户桌面。

## 结论：本轮验收通过

173 → 174 → 175 → 176 → TDD/实现 → 177 → 178 的阶段产物存在，177 的产品和验证驱动 P2 均已独立复审关闭。175 的 D01–D08、K01–K08、R01–R02 在组合验证层中全部覆盖，18 通过、0 失败、0 跳过；没有以跳过补足缺口。允许将本轮 modelDialogRepair 的审核和验收状态更新为 passed/true。

此结论限定当前 macOS 开发构建及两个修复问题；不是新安装包、Windows、物理长按/IME 或真实供应商调用验收。前轮 BYOK 的 allModelsUsable=false 和用户批准的账户范围豁免继续保留。

## 数量、路径与构建核对

独立解析实际 TAP 日志、JSON 和文件元数据，结果与 178、coverage.json、verification.json 及两份台账一致：

| 验证 | 独立核对结果 |
| --- | --- |
| 完整 unit/integration | 243 文件；1709 通过，失败/取消/跳过均 0 |
| 完整 browser | 27 文件；199 通过，失败/取消/跳过均 0 |
| 类型检查、完整构建 | 日志分别为 tsc 和 Prisma/Next/desktop 完整构建；主代理实际执行退出 0；构建产物存在 |
| 最终原生配置模型 | 第十二次 native.json/native.txt，28 项通过；第十一次 28 项通过另存，未重复累计 |
| 模型流程与基础回归 | native-models 11 项、native-baseline 10 项，均通过；本轮三组原生共 49 项检查 |
| 机器覆盖 | 18 个 ID 与 175 精确一致、无重复；已有证据路径全部存在 |
| 当前状态 | 两台账本轮审核 pending、验收 false 是等待本审核的门槛；前轮 BYOK allModelsUsable 仍为 false |

复算 verification.json 的 810 个产品源文件 SHA256，0 差异；main/preload/service 三个 dist SHA256，0 差异；最终 smoke-byok 驱动 SHA256 也匹配。native.json 及 native-eleventh.json 的三个编译指纹均匹配现有 dist。UI 最新源修改为 09:28:34 UTC，renderer 静态 chunk 为 10:08:57 UTC，三个 dist 为 10:08:58 UTC，均早于两次最终原生执行及模型/基础回归。生成的 service routes 在 desktop 构建阶段更新，时间早于对应 dist；没有把它误判为构建后的产品改动。

## 逐用例审核

下表的 unit/component/browser 均指实际全量日志中执行的受控验证；内存桥不是系统剪贴板，本机假接口不是供应商接口。

| 用例 | 核对的实际覆盖 | 结论 |
| --- | --- | --- |
| D01 | builtin-model-catalog、model-settings 的全部文本 preset；native 逐一打开 12 家空 Key 候选并单选，查询/保存均未发生 | 通过 |
| D02 | 同上全部 8 家图片 preset；unit 精确排除 OTHER、错误类型、下线和纯编辑 | 通过 |
| D03 | model-settings 保留选择后填假 Key、元数据回填、替换单选、手动保存；native 选择/取消仍为零模型，models 回归真实保存流程 | 通过 |
| D04 | component 撤销迟到目录及供应商/Key 隔离、刷新 A 时选择 B 的元数据竞态；native 新建文本/图片对话框和供应商切换 | 通过 |
| D05 | builtin-model-catalog 精确同 ID 合并、live 拒绝优先、新 ID、缺失项权限未知；component 保存 B 的正确容量/effort | 通过 |
| D06 | component 认证/网络失败仍有公开候选并可刷新恢复；原有不完整目录状态及 B01/B21 权限提示实际断言保留 | 通过 |
| D07 | unit/component 重复禁用、订阅确认、改 Key 撤销、退役/OTHER/纯编辑不得 live/回插恢复；旧保存选择可留存编辑 | 通过 |
| D08 | model-configuration/model-settings 既有自定义配置；native-models 手填协议/地址/ID、loopback 假接口、手动保存/取消和真实 safeStorage | 通过 |
| K01 | unit、真实 Chrome Controller；macOS CUA Cmd+C 后实际系统剪贴板严格等于局部公开选区，字段保持 password | 通过 |
| K02 | 真实 Chrome 和 Electron 受控粘贴、undo/redo；原生值断言均保留 | 通过 |
| K03 | unit 的 contextmenu/Shift+F10/ContextMenu 及有限协议；实际 macOS AX 六项菜单，CUA 点击复制/粘贴/剪切 | 通过 |
| K04 | unit 空选区/readonly/disabled、先写后删除及失败不剪；真实 Chrome/Electron 剪切与撤销 | 通过 |
| K05 | 普通密码框 copy/cut 保护、其他输入/composer/Monaco 既有回归；Chrome 分别移除、改绑 copy/cut/paste，旧默认不绕过 | 通过 |
| K06 | unit 的选区/值、composition、销毁、取消、新操作、失败写入和 main 菜单 Promise 释放；Chrome 实际失焦 A→B→A | 通过 |
| K07 | strict 六布尔 schema、固定有限命令；提取实际 main 分支的可信 sender/frame、聚焦和返回生命周期测试，177 源码审核 | 通过 |
| K08 | 固定脱敏错误及迟到/失败不剪；Key 不回填、草稿取消不落盘；native-models 公开假 Key 仅经真实安全存储加密，当前扫描无模式命中 | 通过 |
| R01 | 全部 243 个 core 和 27 个 browser 文件实际完整执行，1709/199 全通过 | 通过 |
| R02 | 类型检查、完整构建、当前 dist 的实际 macOS 启动；main/真实 service 入口之前的离线网络及监听防护 | 通过 |

## 原生交互及权限边界

核对 `docs/evidence/model-dialog-repair/native-gui-interactions.md` 的本会话实际 CUA 调用与 AX 记录整理、最终脚本和原生运行记录：通过本项目完整 Electron.app 路径绑定并确认唯一“玄印写作 · 配置模型回归验证”窗口；实际点击 API Key 安全文本栏、发送 super+c，读取原生菜单 AX 39–45 的六项，再实际点击复制 43、粘贴 44、剪切 42。第十二次原全部结果断言通过；第十一次发生陈旧 AX ID 后重新读 AX、真实右键重开再点击通过，未伪造选择结果。

smoke-byok 不直接调用 MenuItem.click、注入产品命令或替换剪贴板桥。Copy 前写入与期望不同的 sentinel 并等待实际读回，避免原剪贴板偶然等于期望导致假通过；菜单 Copy 也有独立 sentinel。其余 X/V/Z、redo、Shift+F10 为 Electron/CDP 驱动，报告明确区分了真实系统按键和 CDP。

离线防护 6 种 TCP 形式拒绝、Unix socket 允许；实际 main/service 各载入防护，总数 2，外部 HTTP/TCP/监听尝试 0，无默认模型，取消后配置数仍为 0。native-models 独立 loopback HTTP 夹具只覆盖自定义流程和真实安全存储；没有据此声称任何公开型号的真实账户调用成功。普通密码、用户绑定和可信窗口/frame/焦点/命令所有权保护没有因验收被绕过。

## 历史失败、剪贴板事故与报告诚实性

独立核对 TDD 为 59 项中 21 失败、38 通过；首轮 core 为 1699/1709、10 失败；首轮 browser 为 198/199、1 失败。原日志保留，夹具缺导出和 popup hidden 等待修订均经 177 审核，未删减原断言；最终全量结果不覆盖历史失败。

native-first/second 的 JSON 仍 passed=false，third 至 tenth 的失败记录存在且无成功声明。旧脚本把 Electron 44 readText 返回的 Promise 直接与字符串比较，谓词恒 false，相关 sentinel/mask/empty 布尔也不是剪贴板内容证据；第七次过早 reload 和第十次误选默认页分别保留。178 未将早期失焦或驱动猜测写成已确认产品原因。

早期未正确备份原剪贴板、可能遗留公开测试文本的事故已在 178 披露并说明已告知用户，未虚称恢复当时丢失的内容。最终驱动逐格式 await getType，在覆盖前构造新 ClipboardItem 备份，仅存 own main RAM；空类型明确处理，恢复失败不吞，生成 passed:true 前等待恢复并核对原文本，再清除 RAM；finally 嵌套关闭自身应用并清理隔离目录。最终两次记录只证明各自运行开始时的剪贴板恢复。

secret-scan.json 明确为启发式供应商凭据模式检查：本次报告 1569 文件、0 命中；不把它写成所有秘密格式的穷举证明。179 落盘及审核状态同步后，主代理可再做末次扫描并更新数量；不需要因此重复供应商请求、系统剪贴板操作或已通过的全量测试。

审核未发现剩余阻断、数字或范围误报。可完成本轮台账的审核关闭并按两个修复问题总结；前轮真实模型权限结论及本轮平台/安装包边界保持不变。
