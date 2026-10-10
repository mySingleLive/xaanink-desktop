# 文生图引导：角色与场景拼贴展示素材

日期：2026-10-11（Asia/Shanghai）。

- 文件：[xianxia-character-scene-v2.png](xianxia-character-scene-v2.png)
- 用途：“要配置文生图模型吗？”卡片的宽幅展示图，替换上一版竖向角色肖像；构图按宣传视觉使用设计。
- 生成方式：内置 `image_gen` 图像生成工具，以 [原角色图](xianxia-character-v1.png) 为身份与风格参考，生成新的横向拼贴构图；不使用 CLI 或项目内模型凭据。
- 尺寸：1774 × 887 px，2:1，PNG；完整保留工具生成的文件，没有程序裁切或重绘。
- 画面：左侧仙侠角色，右侧山峦、云海、古典楼阁、石桥、瀑布与水面，斜向拼贴接缝连接；无文字、Logo 或水印。
- 使用：生成后复制到本目录，HTML 通过相对路径加载；图片铺满卡片，文字位于下方。原肖像与来源记录保留为历史素材。
- 检查范围：已查看工具返回的实际画面，核对 PNG 尺寸与本地引用；未重新验证 HTML 卡片渲染。此静态素材不是用户配置的模型调用结果，旧 v2 截图不代表新卡片效果。

## 最终生成提示词

```text
Use case: stylized-concept.
Asset type: a premium horizontal promotional character-and-environment collage, used as a wide illustration in a text-to-image onboarding card. Generate the illustration itself, without any app UI.
Input image 1: identity and art-style reference for the adult xianxia woman; preserve her recognizable face, dark flowing hair, delicate jade/floral hair ornaments and white-and-pale-jade embroidered hanfu. The reference's vertical framing is not the target layout.
Primary request: 将参考角色重新设计成漂亮、有宣传视觉吸引力的“角色＋场景”拼贴图。横向 2:1 画布，清晰的两块拼贴构图：左侧约 35% 为角色近景竖向画幅，右侧约 65% 为壮丽仙侠场景。人物画幅与场景轻微叠层，以细腻的斜向纸页接缝/浅米色窄边组织画面，拼贴关系明确但边界优雅。不要把它做成仅有人像背景的普通照片。
Environment scene: 右侧完整展示原创仙侠世界：层峦叠嶂的青玉色山峰、云海、远处悬崖上的精致古典楼阁、穿过薄雾的石桥和下方清澈水面。场景要具有独立的环境概念图观感，纵深丰富，规模宏大但细节克制。没有第二个人物。
Style and lighting: match the reference's refined semi-realistic fantasy illustration; fine fabric, flowing hair, exquisite facial detail, cinematic luminous daylight, pale jade and ivory with restrained warm sunlight accents, atmospheric depth, polished concept-art advertising quality, confident beautiful composition, sharp focal detail rather than washed-out fog.
Composition: wide landscape 2:1 aspect ratio, show the full collage across the canvas, the woman's face large enough to remain legible in a 560px-wide UI banner; keep her face and hair ornaments within the portrait panel. The character and scene each need distinct visual prominence. Balanced image with a subtle editorial layered-paper aesthetic, no heavy frames, no filmstrip or contact sheet.
Constraints: one original adult character; keep reference identity and clothing style, no existing franchise; no text, letters, logos, watermark, buttons or UI. Opaque background. Do not stretch the vertical reference image; create a new horizontal composition.
```
