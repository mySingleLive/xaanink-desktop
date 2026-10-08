# 模型 UI 预设依据

日期：2026-10-07。范围：预设隐藏元数据与官方依据，不构成真实模型接口验收。UI v0.11 非自定义仅显示 Key/模型搜索下拉；协议/端点不是可见复杂字段。安装版按作者所选供应商/Key发现完整目录，当前原型不联网。主协议只有 OpenAI / Anthropic。

| 供应商 | 隐藏的默认协议/端点 | 官方依据与注意事项 |
| --- | --- | --- |
| OpenAI | OpenAI / https://api.openai.com/v1 | [官方 API](https://platform.openai.com/docs/api-reference/introduction)；Organization/Project 可选，请求形式独立于协议 |
| Anthropic | Anthropic / https://api.anthropic.com | [Messages](https://platform.claude.com/docs/en/api/http/messages)；请求输出上限必填（隐藏参数按模型元数据生成，不要求用户填写）；思考支持情况依模型，adaptive 不使用预算，enabled 预算模式依接口校验 |
| Google | OpenAI / https://generativelanguage.googleapis.com/v1beta/openai/ | [官方兼容接口](https://ai.google.dev/gemini-api/docs/openai)；使用 Gemini Key，思考档位受具体模型约束 |
| xAI | OpenAI / https://api.x.ai/v1 | [REST 推理](https://docs.x.ai/developers/rest-api-reference/inference) |
| 深度求索 | OpenAI / https://api.deepseek.com | [官方集成](https://api-docs.deepseek.com/guides/agent_integrations/opencode)；亦提供 Anthropic 兼容，UI 初始选择 OpenAI，额外参数按具体模型支持 |
| 月之暗面 | OpenAI / https://api.moonshot.cn/v1 | [官方供应商配置](https://moonshotai.github.io/kimi-cli/zh/configuration/providers.html)；中国/国际站 Key 和端点区分，不混用 Coding 订阅端点 |
| 智谱 | OpenAI / https://api.z.ai/api/paas/v4/ | [Quick start](https://docs.z.ai/guides/overview/quick-start)；通用 API 与 Coding Plan 区分 |
| Xiaomi | OpenAI / https://api.xiaomimimo.com/v1 | [官方思考内容说明](https://platform.xiaomimimo.com/docs/en-US/usage-guide/passing-back-reasoning_content)；OpenAI/Anthropic 均兼容，UI 默认 OpenAI，思考类型 enabled/disabled |
| 阿里巴巴 | OpenAI / https://dashscope.aliyuncs.com/compatible-mode/v1 | [官方兼容说明](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope)；北京预设依据 [官方端点](https://help.aliyun.com/en/model-studio/base-url)；区域/工作空间 Key 隔离，其他端点走自定义，不静默替换 |
| MiniMax | OpenAI / https://api.minimax.io/v1 | [官方 OpenAI 格式](https://platform.minimax.io/docs/api-reference/text-openai-api)；模型 ID/计划与接口能力单独确认 |
| 腾讯 | OpenAI / https://tokenhub.tencentmaas.com/v1 | [2026-09-30 旧平台停服及迁移公告](https://cloud.tencent.com/document/product/1729/131925)：新增配置使用 TokenHub 国内站 Key；不自动修改已有端点或迁移旧 Key，图像预设的国际站凭据另行配置 |
| 字节跳动 | OpenAI / https://ark.cn-beijing.volces.com/api/v3 | [方舟快速开始](https://docs.volcengine.com/docs/ark/quick-start?lang=zh)；北京区域，目录与 Key 权限分开核验 |
| 自定义 | 协议空值，用户选择 OpenAI / Anthropic | 用户填写名称、端点、模型 ID；HTTPS 或本机回环 HTTP，禁止 URL 内凭据，草稿改地址/协议须重新输入 Key，成功保存才撤销旧授权 |

模型配置使用独立草稿，「保存模型 / 测试连接 / 取消」右对齐。外观、快捷键、智能体即时更新，用户资料独立保存。非自定义隐藏协议/地址/参数；必要参数由真实模型元数据与原 Web 契约决定，未支持字段不发送。草稿取消不改旧模型，成功提交供应商/协议/地址变更或替换 Key（含同一端点）才撤销旧授权并增加授权版本；新 Key 不沿用旧权限验证状态。

## 目录、分类与测试

两类添加入口继承文本/文生图类别，无默认用途或模型分类配置项。安装版必须处理全目录/全部分页及授权范围，不假设全部兼容接口有 GET /models。无授权发现时官方目录与权限未知状态分开表达；失败保留草稿/已有记录。详见 [补充调研](provider-catalog-research.md)。当前目录是显式示例，不是真实供应商型号表或能力表。

菜单按输出类别过滤，依据补充调研的八家文生图预设/十二家文本预设；自定义保留。腾讯文生图隐藏元数据采用 TokenHub 图像端点，与文本混元服务分离，其他非兼容图像接口也须独立适配。测试在当前框直接逐项执行全部已选草稿目标；框内持续标注数量/范围/费用，按钮加载且禁重复，字段/保存锁定，取消配置即终止。完成弹出逐项结果，返回保留原草稿，不保存模型，也不能证明全目录均可用。每项文本短回复，文生图1张图片。图像输入不等于图像输出：[Claude 模型概览](https://platform.claude.com/docs/en/models/overview)区分输入图像与文本输出；图像请求按实际接口，如 [OpenAI Images](https://developers.openai.com/api/reference/resources/images)。技术阶段逐模型核验，不把文本兼容端点或协议标签视为图像输出兼容性证据。

智能体默认模型来自已保存有效的文本/图像记录，思考选项复用原 `src/lib/ai/thinking-effort.ts`，默认模式复用原会话标准/计划契约。默认值只影响新任务；删除/禁用后不静默补位。

模型选择项使用模型家族Logo，智谱为官方黑底圆角Z图形；选择器外观/图标不改变原有效性、Key、即时回执和分类约束。详见 UI v0.8。

UI v0.11：可用模型为可搜索、滚动下拉，收起显示当前名称/Logo；添加和编辑均为单选，已添加禁选，类别过滤保持。自定义去输出输入、上下文十进制K/M；隐藏的必要输出参数仍依协议/模型合法默认值生成，不以UI删项作为删协议参数的依据。

UI v0.11 仅调整表单呈现：供应商、Key、型号以及自定义/高级属性统一上标题下全宽控件，不改变预设目录、协议参数或单选语义。
