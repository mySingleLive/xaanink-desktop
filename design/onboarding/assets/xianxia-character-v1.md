# 文生图引导角色展示素材

日期：2026-10-11（Asia/Shanghai）。

- 文件：[xianxia-character-v1.png](xianxia-character-v1.png)
- 用途：HTML 设计稿中“要配置文生图模型吗？”卡片的静态角色展示图，替换通用图片图标。
- 生成方式：内置 `image_gen` 图像生成工具；原创仙侠角色肖像，不使用 CLI 或项目内模型凭据。
- 尺寸：1122 × 1402 px，PNG，保留工具生成的完整文件。
- 保存：生成完成后复制到本目录；查看器加载仓库本地文件，不访问图像服务，不调用用户配置的文生图模型。
- 已检查生成画面：单个人物、仙侠服饰、肖像清晰、没有水印或文字。实际 HTML 卡片渲染尚未重新验证，已有 v2 截图不能作为该素材布局的证据。

## 最终生成提示词

```text
Use case: stylized-concept.
Asset type: a polished character illustration for the optional text-to-image onboarding card in a Chinese creative-writing desktop app, not a screenshot or UI mockup.
Primary request: 一张精致好看的原创仙侠角色肖像。成年女性仙侠修士，清雅而有神采，乌黑长发，细致的玉簪，白色与青玉色的飘逸汉服，衣料轻盈、纹理精美，五官自然优美，温柔坚定的眼神。东方幻想插画，细腻的游戏角色原画质感，手绘与柔和写实结合，克制而有高级感。
Scene/backdrop: 朦胧的云雾与远山，简洁的浅色背景，突出人物。
Composition/framing: portrait 4:5 composition, centered head-and-upper-body portrait, full hairstyle visible with breathing room above, face large and readable when displayed as a 144px-wide card illustration. Character looking toward the viewer, graceful three-quarter pose. No hands or weapons in frame.
Lighting/mood: soft cinematic daylight, delicate hair highlights, serene and luminous, attractive and inviting.
Constraints: a single original adult character, no existing franchise character, no text, letters, logo, watermark, UI controls, frames or contact sheet. Opaque painted background; produce the artwork itself.
```
