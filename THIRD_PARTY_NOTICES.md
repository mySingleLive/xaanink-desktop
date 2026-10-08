# 第三方资源与来源

项目自有源码、文档和设计采用 [GNU GPL-3.0](LICENSE)（`GPL-3.0-only`）；Copyright (c) 2026 mySingleLive。第三方资源依各自许可证发布，不能用项目许可证替换。

| 资源 | 来源 | 许可证与位置 |
| --- | --- | --- |
| Noto Sans SC | 上游 `public/fonts/noto-sans-sc/NotoSansSC-Regular.ttf.gz`，预览解压使用 | SIL Open Font License；`design/assets/NotoSansSC-LICENSE.txt` |
| Lucide 图标 | 本机随工作区工具提供的 `lucide` 包，UMD 版，仅为离线设计预览 | ISC；`design/assets/Lucide-LICENSE.txt` |
| 十一家供应商与七份包内模型家族 Logo | [LobeHub Icons](https://github.com/lobehub/lobe-icons)，npm @lobehub/icons-static-svg@1.95.1；静态 SVG，无包代码执行 | MIT；`design/assets/providers/LICENSE.txt`；逐图来源/指纹/着色处理见 `design/provider-logo-provenance.json` 和 `design/model-logo-provenance.json`，Logo 商标仍属各供应商 |
| 温玉 SVG 与主题令牌 | `mySingleLive/xuanxiang.ink@55a62560dc4818143469abb12717a23c752ade8c` | 作者现有资产；指纹和复制方法见 `design/assets-provenance.json` |

智谱 / Z.ai 本轮使用 [官方黑底圆角 SVG](https://z-cdn.chatglm.cn/z-ai/static/logo.svg)，与 [官网](https://chat.z.ai/) favicon及原 Web 来源相同。本地版保留可见图形与配色、去掉无用样式；未声明官方资源受 MIT 许可，品牌资产及商标仍属 Z.ai。处理方法与指纹见来源清单。

实现阶段新增依赖时扩展声明，并保存对应许可证。上游仓库本身的许可证不因本项目的许可证而改变。

Kimi 家族本轮使用 [Kimi 官网](https://www.kimi.com/) 引用的官方图标集合 KforKimi_f1 字形，以官网应用图标为配色参考，放在用户指定的黑底圆角块上。只提取静态矢量路径，不执行官方脚本；该品牌资产不声明 MIT 许可，来源和处理指纹见 model-logo-provenance.json。GPT 使用 LobeHub 包内的原单色路径。

安装包内运行资源的许可文本放在 `Contents/Resources/app/runtime-licenses/`（Windows 为 `resources/app/runtime-licenses/`）：NotoSansSC-OFL.txt、LobeHub-Icons-MIT.txt、Lucide-ISC.txt、Monaco-MIT.txt、Electron-MIT.txt、Electron-Chromium-LICENSES.html。`provenance.json` 记录原资源路径、许可文本SHA256以及原温玉SVG指纹。官方 Z.ai/Kimi 品牌声明仍按上述来源，不因资源拷贝变更许可。

Sharp 的平台动态库及其依赖按各自许可发布，包内 `Sharp-libvips-THIRD-PARTY-NOTICES.md` 来自 [sharp-libvips v1.2.4 上游声明](https://github.com/lovell/sharp-libvips/blob/v1.2.4/THIRD-PARTY-NOTICES.md)；`provenance.json` 同时记录实际平台包版本与 `versions.json`。生产依赖自身的 LICENSE 保留在包内 `node_modules`。这份来源记录不代表已完成对全部第三方依赖的发行审核；完整对外发行许可核对仍属于发行前检查。
