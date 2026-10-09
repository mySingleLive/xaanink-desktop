# 配置模型目录与 API Key 剪贴板修复验收

日期：2026-10-09。本轮两个问题的实现及全部 18 项用例已执行通过，独立验收审核见 179。产物顺序为 173 方案 → 174 方案审核 → 175 用例 → 176 用例审核 → TDD 与实现 → 177 code review → 本报告 → 179 验收审核。前轮 164–172 BYOK 的官网调研、实际账户权限及用户批准跳过范围保持原结论。

## 结果与实现

选择内置供应商时，无需先填 Key 或等待供应商接口，即可显示对应的公开官网型号、搜索并单选。12 家文本供应商和 8 家文生图供应商全部在当前编译应用内逐一验证；成功目录按精确 ID 更新元数据，拒绝状态优先，下线、错误类型和纯编辑型号不会回插成可用候选。供应商与 Key 变化撤销旧查询；保存仍须手动确认。自定义供应商继续手填协议、地址和型号。

API Key 保持密码掩码。默认复制、剪切与粘贴通过现有命令所有权和主进程本地剪贴板桥执行；普通密码框保护及用户改绑/移除快捷键保持生效。鼠标右键或 Shift+F10 显示实际 Electron 原生菜单，包含撤销、重做、剪切、复制、粘贴与全选；菜单只传有限命令及布尔能力。失焦往返、修改、组合输入、销毁或取消撤销迟到操作。

实现位于共享目录、ModelConfigurationDialog、DesktopCommandController、input-commands、native-text-edits 和受限原生输入菜单桥。没有改写已批准的工作台 React 业务组件，也没有新增默认模型或后台 HTTP 服务。

## 执行与证据

| 层级 | 实际执行结果 | 证据 |
| --- | --- | --- |
| 旧实现 TDD 回归 | 59 项中 21 项失败、38 项通过，确认空 Key 目录及剪贴板问题可复现 | evidence/model-dialog-repair/tdd-red.txt |
| unit + integration 全量 | 243 个文件，1709/1709；失败、取消、跳过均为 0 | evidence/model-dialog-repair/core-tests.txt |
| 浏览器全量 | 27 个文件，199/199；失败、取消、跳过均为 0 | evidence/model-dialog-repair/browser-tests.txt |
| 类型检查 | npm run typecheck，退出 0 | evidence/model-dialog-repair/typecheck.txt |
| 完整构建 | npm run build，Prisma、Next 静态 UI、main/preload/service 全部完成，退出 0 | evidence/model-dialog-repair/build.txt |
| 实际 macOS 配置模型 | 28 项检查通过，含 20 组空 Key 目录、真实系统剪贴板和原生菜单 | evidence/model-dialog-repair/native.json、native.txt |
| 实际 macOS 模型配置回归 | 11 项检查通过，含手动保存、取消、假 Key 的真实 safeStorage 加密、自定义本机接口 | evidence/model-dialog-repair/native-models.json |
| 实际 macOS 启动回归 | 10 项检查通过，含原生菜单、沙箱、主题持久化与快捷键录制/冲突 | evidence/model-dialog-repair/native-baseline.json |

全量命令使用 Node 24.19.0：`node --import tsx --test --test-concurrency=1 --test-reporter=tap tests/unit/*.test.ts tests/integration/*.test.ts` 与相同参数的 `tests/browser/*.test.ts`。浏览器使用系统 Google Chrome，路径由 XAANINK_TEST_CHROMIUM 明确指定。原生命令为 `XAANINK_NATIVE_INPUT_MENU=1 node scripts/smoke-byok.mjs`、`node scripts/smoke-models.mjs`、`node scripts/smoke-electron.mjs`；全部使用规范化 TMPDIR 和独立 XAANINK_TEST_ROOT，退出 0。

## 逐项覆盖

| ID | 已验证行为与执行层 | 结果 |
| --- | --- | --- |
| D01 | builtin-model-catalog、model-settings：12 家空 Key 文本目录及无需请求单选；实际 Electron 逐供应商选择 | 通过 |
| D02 | 同上：8 家图片目录；错误类型、OTHER、下线和纯编辑排除 | 通过 |
| D03 | model-settings：单选、填假 Key 保留型号、元数据与手动保存；原生逐项选择/取消不落盘 | 通过 |
| D04 | model-settings：供应商/Key 变化撤销旧目录及 A 刷新时选择 B 的元数据竞态；原生文本/图片新对话框和供应商切换 | 通过 |
| D05 | builtin-model-catalog：精确 ID 合并、新增、拒绝优先、不授予缺失项权限；model-settings 元数据竞态测试 | 通过 |
| D06 | model-settings：认证/网络错误保留候选并刷新恢复；原有不完整目录及 B01/B21 警告测试保留提示 | 通过 |
| D07 | builtin-model-catalog/model-settings：重复、订阅确认与 Key 撤销、退役/错误类型回插防护、旧保存型号编辑 | 通过 |
| D08 | 原有 model-configuration 回归与真实 Electron custom 模型本机假接口、保存、取消、加密 | 通过 |
| K01 | input-commands/native-text-edits、实际 Chrome；实际 macOS Cmd+C 将局部选区写到系统剪贴板，密码仍遮蔽 | 通过 |
| K02 | 实际 Chrome 与 Electron 的受控粘贴、原生撤销/重做 | 通过 |
| K03 | input-context-menu 的右键/Shift+F10/ContextMenu 协议；macOS 实际原生菜单包含六项，实际点击复制/粘贴/剪切 | 通过 |
| K04 | input-commands 的空选区/readonly/disabled；native-text-edits 先写后剪；真实 Chrome/Electron 剪切及撤销 | 通过 |
| K05 | 普通密码保护、composer/Monaco/普通文本回归；Chrome 逐项移除和改绑 copy/cut/paste | 通过 |
| K06 | unit 覆盖失焦往返、选区/值、composition、销毁、取消、新操作与写失败；Chrome 实际 DOM A→B→A 撤销菜单及剪切 | 通过 |
| K07 | strict schema、有限命令、主窗口信任与前后生命周期检查；clipboard-ipc 与 177 源码审核 | 通过 |
| K08 | 固定脱敏错误、失败不剪切；Key 不回填、取消不保存；原生自定义模型假 Key 只经真实安全存储加密 | 通过 |
| R01 | 所有 unit/integration/browser 文件全量运行，均通过 | 通过 |
| R02 | 类型检查、完整重新构建、当前编译产物真实 macOS 离线启动；主进程和真实 service worker 前置网络防护 | 通过 |

机器映射与最终数量见 evidence/model-dialog-repair/coverage.json 和 verification.json。不同层级合并验证用例；组件替身、浏览器内存桥、本机假接口不会标为真实供应商调用。

## 原生交互与产物一致性

Electron 44.6.0 在 macOS 上从本仓库实际 dist/main/index.cjs 启动，窗口独立标题为“玄印写作 · 配置模型回归验证”。CUA 绑定本项目完整 Electron.app 路径并核对标题，实际点击 API Key、发送 macOS Cmd+C，然后读取并点击实际原生菜单的复制、粘贴和剪切。逐次工具与 AX 步骤见 evidence/model-dialog-repair/native-gui-interactions.md。Cmd+X/V/Z、重做与 Shift+F10 由 Electron/CDP 驱动，仍以实际受控字段和系统剪贴板结果断言；没有注入命令、替换桥或削弱焦点/所有权检查。桌面启动回归的长按是 CDP repeat，不宣称物理长按或系统 IME 验证。

离线测试在 main 与 service 入口之前阻止外部 HTTP、TCP 连接及 TCP 监听；6 种 TCP 形式的防护预检拒绝、Unix socket 预检允许。实际 main/service 加载防护 2 次，外部请求/监听尝试 0；最终配置模型数仍为 0。Playwright 自己的调试通道不属于产品 HTTP 服务。custom 回归使用独立本机 HTTP 假接口，仅测试流程和真实安全存储。

native.json 记录 main/preload/service 的 SHA256，验收整理时逐一与现有 dist 复算相等；verification.json 记录当前 810 个产品源文件指纹及最终验证驱动指纹。完成构建后没有修改产品源码，仅修补原生验证驱动和报告。

## 失败记录与验证驱动修正

TDD 失败保留。首轮全量 core 的 10 项失败来自旧 Controller 夹具缺少新增导出，修补夹具后原断言通过；首轮浏览器唯一 CFG62-U07 失败来自 Escape 后异步 popup 关闭等待，单项复核及只增加实际 hidden 等待后全量通过，业务代码和原断言保持不变。这些修改均由 177 复审。

早期原生运行的失败日志 native-first、second、third 至 tenth 保留，不把当时猜测的失焦或驱动差异写成已证原因。最终确认此前脚本在 Electron 44 上将 `clipboard.readText()` 的 Promise 直接与字符串比较，导致复制误报；产品 main 的读写已有 await。第七次过早诊断 reload 使启动中断、第十次误选本工具启动的同路径默认页，均未记为通过，最终脚本去除诊断包装与 reload，核对唯一窗口后重跑通过。

Electron 44 的异步接口以本地 electron.d.ts 为准；[官方 ClipboardItem 实现](https://raw.githubusercontent.com/electron/electron/v44.6.0/lib/browser/api/clipboard-item.ts)还明确禁止把 read 返回的对象直接写回。最终脚本在覆盖前逐格式 await getType，构造新的 ClipboardItem 并仅存于自身 main 内存，处理空格式；生成成功证据前 await write 恢复并核对原文本，失败显式报固定脱敏错误，finally 保证关闭和清理。当前完整脚本的第十二次运行 28 项通过；第十一次通过结果另行保留。

早期脚本没有正确备份原剪贴板，可能曾把用户剪贴板替换为公开测试文本，不能声称恢复了当时已丢失的内容。此问题已告知用户；最终两次运行均完成自身开始时剪贴板的正确恢复，证据不包含原剪贴板内容。

## 验收边界

本轮不读取或调用真实供应商 Key，未向任何文件保存真实凭据，测试只使用公开假值。凭据模式扫描结果仅为启发式检查，详见 secret-scan.json；不冒称已对所有可能的秘密格式穷举证明。公开候选可见不等于账户拥有调用权限；前轮 allModelsUsable=false 及已批准跳过仍保留。

两个本轮问题与 18 项用例已执行通过，类型检查及构建通过。独立验收结论以 179 为准；本轮未创建或验收新安装包，也未进行 Windows 或物理 IME 验证。迁移和需求台账只新增 modelDialogRepair，其他验收结果保持不变。
