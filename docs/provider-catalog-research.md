# 供应商目录与图标补充调研

日期：2026-10-07；用于产品 v0.7 / UI v0.8 修订，不是技术方案或真实接口验收。

用户要求：预设供应商配置只显示 API Key 与模型列表，列表覆盖供应商全部可用模型；自定义供应商保留接口字段。新增腾讯、字节跳动，并为每家供应商提供对应彩色 Logo。

## 目录范围与事实边界

安装版须获取所选供应商、默认端点与 Key 权限范围内的完整目录，区分文本输出和图像生成能力，处理全部分页。不得用若干精选型号、第一分页、名称猜测或静态示例充当完整目录。公开目录与 Key 可用范围不同；供应商不提供授权目录接口时，可以展示已核对的官方完整目录，但权限未知的条目必须标注「权限待验证」，不能宣称可调用。用户主动测试单个模型不能证明整份目录均可用。

火山方舟的 [模型列表](https://docs.volcengine.com/docs/ark/model-list?lang=zh) 是公开目录；[API Key 文档](https://docs.volcengine.com/docs/ark/api-key?lang=zh) 描述项目/模型权限；[在线推理](https://docs.volcengine.com/docs/ark/online-inference-standard?lang=zh) 区分公共 Model ID 与用户部署端点。由此推断，公开列表不能直接作为某 Key 的授权全集，也不能假设各供应商都有通用 GET /models。技术阶段需要逐供应商核验元数据发现能力；该核验尚未执行，不能宣告完整目录已实现。

选择供应商并输入 Key 是安装版按该供应商发现模型元数据的触发条件。只访问用户选择的供应商，无平台代理、账号服务或额外云 AccessKey/SecretKey。目录发现不发生成请求；失败区分认证、网络、权限、接口不支持，保留草稿，允许重试/取消。刷新不删除作者已保存模型；目录中已停用/不可用型号明确提示。

## 新增预设端点

| 供应商 | 默认端点及依据 | 范围 |
| --- | --- | --- |
| 腾讯 | https://tokenhub.tencentmaas.com/v1；[旧平台停服及 TokenHub 迁移公告](https://cloud.tencent.com/document/product/1729/131925) | 2026-10-07 实现核验修正：旧混元平台已于2026-09-30停服。仅新增预设改为 TokenHub 国内站，需要该站 Key；已有记录/旧 Key 不自动迁移。主预设采用 OpenAI，不加入云签名凭据 |
| 字节跳动 | https://ark.cn-beijing.volces.com/api/v3；[官方快速开始](https://docs.volcengine.com/docs/ark/quick-start?lang=zh) | 北京区域方舟 API Key；目录与模型/端点权限需分别核验 |
| 阿里巴巴 | https://dashscope.aliyuncs.com/compatible-mode/v1；[官方区域端点](https://help.aliyun.com/en/model-studio/base-url) | 北京默认预设；[Key 按区域/工作空间区分](https://help.aliyun.cn/zh/model-studio/get-api-key)，其他区域/工作空间使用自定义供应商，不静默混用 Key |

其他官方依据见 [模型预设](provider-ui-presets.md)。模型/思考/图像能力按实际模型信息与原 Web 能力解析器判断，图像输入不等于图像输出。

## Logo 来源

采用 [LobeHub Icons](https://github.com/lobehub/lobe-icons) 的 npm 官方注册表包 @lobehub/icons-static-svg@1.95.1 中静态 SVG。仅解包资产，没有安装或运行包代码。包版本、完整性值、原始/处理后 SHA-256 与逐 Logo 映射见 `design/provider-logo-provenance.json`；MIT 原文随本地资产保存。已有彩色 SVG 保留原色；单色图形按原形着色，色值是桌面预览处理，不声明为官方品牌标准色。

月之暗面对应 Moonshot 图形、阿里巴巴对应 Alibaba、腾讯对应 Tencent、字节跳动对应 ByteDance，不以模型家族图标替代供应商主体。智谱采用用户本轮指定的 z.ai 黑底圆角块、白色 Z。z.ai 官网当前 favicon/apple-touch-icon 引用 [官方 SVG](https://z-cdn.chatglm.cn/z-ai/static/logo.svg)，与原 Web `provider-logos.tsx` 的来源一致。仅保留SVG可见路径/多边形及原配色，省略未使用的Illustrator样式，原始/输出指纹及独立品牌资产归属在清单中记录，不将官方资产误称 MIT。其他十一家供应商仍为原 MIT 包。

模型家族图标从同版本 MIT 包提供，Claude/Gemini/Grok/Kimi/Qwen/混元/豆包与供应商主体图标分开；其余复用已对应家族的供应商图形。映射和逐图指纹见 `model-logo-provenance.json`，未知/自定义保留通用图标，不通过名称猜测。Logo 在本地提供，不从 CDN 请求。

## 原型证据限制

`design/provider-catalog-preview.js` 是有意使用 demo ID 和「示例」名称的布局夹具；既不是供应商真实型号表，也不是逐模型能力兼容表；供应商输出类别依据下表，demo 型号/档位仅为布局演示。默认思考档位仅用于演示按能力出现/消失。实际安装版必须替换为经核验的完整目录和原 Web 思考能力契约；此阶段没有使用真实 Key、发现目录或产生费用。

## v0.7 输出类别筛选依据

核对日期：2026-10-07。按输出能力筛选，不按是否接受图片输入判断。文本十二家保留，依据上表及 `provider-ui-presets.md` 中各家文本官方接口；当前文生图八家及依据如下。未知能力不推断，不自动试生成；安装版需更新官方能力目录并分别发现 Key 权限。当前排除 Anthropic、深度求索、月之暗面、Xiaomi 只表示本次未核验到其文生图预设，不断言其永远没有此能力。

| 文生图供应商 | 公开生成能力依据 | 接口边界 |
| --- | --- | --- |
| OpenAI | [Images API](https://developers.openai.com/api/reference/resources/images) | 图像接口与文本任务分开 |
| Google | [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation) | 原生图像生成，不等同 OpenAI 文本兼容接口 |
| xAI | [Image generation](https://docs.x.ai/developers/model-capabilities/images/generation) | Images generation 接口 |
| 智谱 | [Generate Image](https://docs.z.ai/api-reference/image/generate-image) | 图像生成，通用 API / Coding Plan 权限分别核验 |
| 阿里巴巴 | [文生图](https://help.aliyun.com/zh/model-studio/text-to-image) | Qwen / 万相图像输出；区域/模型适配不同 |
| MiniMax | [Text to image](https://platform.minimax.io/docs/api-reference/image-generation-t2i) | Bearer API Key，`image_generation` 不是通用 Images 路径 |
| 腾讯 | [Hy 生图调用指南](https://intl.cloud.tencent.com/zh/document/product/1300/83708) | TokenHub API Key Bearer；国际站 `https://tokenhub-intl.tencentcloudmaas.com/v1` 的 wand 图像路径，不能复用混元文本端点/凭据或旧云签名 |
| 字节跳动 | [Image generation API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh) | 方舟图像生成路径；按区域/授权发现 |

从这些官方接口可推断：隐藏的 OpenAI / Anthropic 协议标记不能证明图像路由兼容，实际 App 要按供应商和输出类别适配真实路径、请求/响应、Key 所属站点和区域。腾讯图像预览元数据使用 TokenHub 地址，与文本预设分离；不提供旧式 SecretId/SecretKey 字段。自定义在两类菜单保留，表示作者配置入口，真实输出能力待测试，并不宣称自定义全部支持。

测试改为直接执行全部已选草稿目标；每项结果只证明该项测试，不代表全目录/权限。原型没有生成请求，真实测试授权和适配留待后续阶段。
