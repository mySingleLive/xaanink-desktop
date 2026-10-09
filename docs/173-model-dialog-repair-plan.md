# 配置模型目录与剪贴板修复方案

日期：2026-10-09。范围：内置供应商候选目录、API Key 的复制粘贴和右键菜单。延续 164–172 的协议、权限和真实调用验收结论。

## 已确认原因

`ModelConfigurationDialog.tsx` 仅把 `discoverModels` 返回值作为选项，且无 Key 时禁用选择；因此首次打开没有内置列表，查询失败也没有候选项。`input-commands.ts` 禁止所有密码框复制/剪切；`DesktopCommandController.tsx` 把默认输入快捷键交给 Chromium，密码框复制仍被浏览器拒绝。普通工作台没有输入框右键菜单。

## 实施设计

1. 建立浏览器可用的共享公开目录。复用 `provider-capabilities.ts` 已核实的 7 家资料；把腾讯、火山的精确分类常量提取成共享公开数据，供适配器与候选目录共用。补入 Anthropic、xAI、阿里官网精确 ID；文本/文生图分类明确，排除已下线、OTHER、纯编辑模型。未知容量留空，不由名称推断。目录没有凭据、不触发网络、不创建已配置模型。
2. 每次选择供应商立即显示公开候选，Key 为空时也能选择。成功联网目录按 ID 覆盖候选元数据并加入新型号；官网候选中未授权项目仍标为权限未知，接口错误保留原文分类，界面明确候选不代表权限。合并不放宽 available:false：MiniMax 订阅限定默认禁用，只有主进程确认当前凭据支持订阅时返回 available:true 才启用；实时返回 available:false 始终优先。已下线、OTHER、纯编辑筛除规则继续生效，晚到或当前已选条目的回插不得恢复这些已知禁用规则。旧已保存型号保留原选择以编辑，但不新增为公开推荐。切换供应商/种类和变更 Key 撤销旧查询；晚到结果不回填。保留单选、重复禁用、旧配置和手动保存。
3. API Key 保持 `type=password`，仅添加明确的剪贴板授权标记。普通密码框仍不允许复制/剪切。该字段默认复制、剪切、粘贴快捷键走现有命令所有权与本地剪贴板桥。复制/剪切明确用 writeClipboardText 写选区；剪切须写入成功且控件所有权、epoch、值与选区仍一致，才执行 Chromium 原生 delete。粘贴用原生 insertText；两者保留 React 更新和撤销记录，不依赖密码框原生 copy/cut。失败不打印字段内容。
4. 增加受限原生输入菜单桥：只监听显式标记 API Key 的 contextmenu/Shift+F10/ContextMenu 事件。renderer 只传每项能否执行的布尔值，main 验证可信主窗口、有限菜单命令和 strict 布尔结构，以 Electron Menu.popup 展示撤销/重做/剪切/复制/粘贴/全选；选择后 invoke 返回命令 ID 或取消，不经全局 executeCommand 转发。renderer 保留调用时的输入目标/选区，在返回时确认目标仍连接、仍有焦点、选区和值未变；再通过现有命令总线对原控件执行。失焦往返、输入、keydown、composition、销毁均撤销旧菜单操作。main 窗口关闭/销毁也关闭菜单并释放 Promise；菜单 IPC 不携带 Key 或剪贴板内容。

## 官网依据

- [Anthropic 模型总览](https://platform.claude.com/docs/en/models/overview)、[生命周期与下线表](https://platform.claude.com/docs/en/about-claude/model-deprecations)（保留 Active 精确 ID；旧容量未知留空；Retired 阻止回插，尚未下线的 Deprecated 显示计划日期；Mythos 受限项默认禁用）
- [Mythos 5.1 访问要求](https://platform.claude.com/docs/en/models/mythos-5-1/overview)、[Mythos 5/Preview 访问范围](https://platform.claude.com/docs/en/models/fable-5/migration-guide)
- [xAI 模型](https://docs.x.ai/developers/models)、[Grok 4.7](https://docs.x.ai/developers/models/grok-4.7)、[文生图](https://docs.x.ai/developers/models/grok-imagine-image-2.0)
- [阿里文本目录](https://help.aliyun.com/zh/model-studio/text-generation-model)、[图片目录](https://help.aliyun.com/zh/model-studio/image-model)
- 腾讯、火山与其他 7 家具体出处保留在共享数据和 164 调研文档，不把官网列出当作当前 Key 调用通过。

## 验证与交付顺序

独立审核本方案 → 用例文档及独立审核 → 先写回归测试并确认旧代码失败 → 实现及独立 code review → typecheck、全量 unit/integration/browser、重新构建、编译产物的实际 macOS Electron 验证 → 用例覆盖报告及独立验收审核。

原生验证覆盖 12 家文本和 8 家图片供应商的空 Key 列表、切换、单选、取消不落盘，以及 API Key 默认快捷键、实际系统剪贴板、原生右键菜单、撤销、掩码。使用公开假值与隔离目录，清理测试剪贴板；不调用供应商、不读取或记录真实 Key。保留其他人的修改与旧 BYOK 证据。
