# 玄印写作字标与图形资产实施证据

2026-10-08。范围：`public/brand/**` 的 SVG/PNG、`design/assets` 的横版字标和图标 SVG，以及生成脚本。遵循 121/122 方案、124 的 BRAND-P03 用例；安装包 ICNS/ICO 由封包阶段生成。

## 实施

- 18 个 SVG 的 title、desc、aria-label 使用「玄印写作」。横版与正式版实际替换旧中文 path 为四字「玄印写作」，正式版底部实际替换英文 path 为 `XaanInk`。
- 字标来自仓库 `design/assets/NotoSansSC-Regular.ttf`，通过已安装的 `@pdf-lib/fontkit` 布局并生成 glyph path。SVG 带 `data-wordmark="玄印写作"`、字体来源和 SHA-256 记录；渲染不使用 text、系统字体、外部资源或位图。
- 首个完整图形 group 原样保留。所有资产的 width、height、viewBox 保留；横版字标在原 248×74 区域居中适配四字，正式版中文字标沿用同等区域，英文名居中放在原底部区域。
- 4 个现有 PNG 从相应 SVG 重新生成，尺寸仍为 1024×1024。它们是无文字的图形，渲染像素保持一致，因此 Git 不显示 PNG 内容变更。

## 字体与许可

字体内部名称为 `Noto Sans SC`，版本为 `2.004`，版权记录为 `© 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.`。SHA-256：

```text
6fb994f703468a02b8abff77a75ec1ece966b03c7a93a213454531fffae1f53e
```

本次使用已有字体文件，没有修改或新增字体。原许可证保留在 `design/assets/NotoSansSC-LICENSE.txt`，为 SIL Open Font License 1.1；SVG 是该字体生成的轮廓图形，文件中不包含可安装字体。

## 实际命令与结果

使用 Node.js 24.18.0：

```sh
PATH=/Users/dt_flys/.nvm/versions/node/v24.18.0/bin:$PATH node scripts/generate-brand-assets.mjs
PATH=/Users/dt_flys/.nvm/versions/node/v24.18.0/bin:$PATH node --import tsx --test --test-name-pattern=BRAND-P03 tests/unit/brand-product-identity.test.ts
```

生成器结果：`vectors=18`、`bitmaps=4`，字体哈希与上文一致。BRAND-P03 结果：1 个用例、1 个通过、0 个失败。

另外实际执行 Node assert 验证：从 `git show HEAD:<asset>` 读取原 SVG，对比首个完整图形 group 和三项尺寸；对 12 个无文字 SVG 去掉 aria-label/title/desc 后逐字比较；对 4 个 PNG 用 sharp 解码 raw 像素逐字比较；对全部 22 个输出取 SHA-256、重跑生成器、再次比较。结果如下：

```json
{"vectors":18,"dimensionsAndSymbolPreserved":18,"metadataOnlyVectors":12,"bitmapPixelsPreserved":4,"idempotent":true}
```

sharp 渲染到 `/private/tmp/xaanink-brand-contact-sheet.png`，另外输出 2 倍横版 `/private/tmp/xaanink-horizontal-ink.png` 和 `/private/tmp/xaanink-horizontal-paper.png`；已使用 `view_image` 实际检查联系图与宣纸横版大图。玄墨/宣纸的横版及正式版四字完整、字形清晰，没有裁切；正式版底部为 XaanInk。图形版仍为原图形，颜色、大小及轮廓不变。这些是本次新生成渲染证据，不改写任何历史截图。

本范围只完成资产和 BRAND-P03 验证，不代表封包、目标系统启动或全量业务验收。
