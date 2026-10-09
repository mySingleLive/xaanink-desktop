// Exact public TEXT/IMAGE classifications from official provider tables.
// Tencent checked 2026-10-07; Ark table updated 2026-09-28.
// Shared with discovery so offline choices cannot drift from adapter IDs.
export const tencentTextSource = "https://cloud.tencent.com/document/product/1823/130078"
export const tencentImageSource = "https://intl.cloud.tencent.com/zh/document/product/1300/83708"
export const tencentViduSource = "https://intl.cloud.tencent.com/zh/document/product/1300/83709"
export const tencentWandSource = "https://intl.cloud.tencent.com/zh/document/product/1300/83859"
export const tencentSeedreamSource = "https://intl.cloud.tencent.com/zh/document/product/1300/83710"
export const tencentVisionSource = "https://cloud.tencent.com/document/product/1823/130051"
export const tencentText = new Set(["hy4-preview", "hy3", "hy-mt2-pro", "hy-mt2-plus", "hy-mt2-lite", "hunyuan-role-latest", "hy-role", "deepseek/deepseek-flash", "deepseek-v4-flash-202605", "deepseek/deepseek-v4-flash-0731", "deepseek/deepseek-v4-flash", "deepseek-v4-pro-202606", "deepseek/deepseek-v4-pro-0813", "deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash-vision-exp", "deepseek-v4-flash-0731", "deepseek-v4-pro-0813", "deepseek-v4-flash", "deepseek-v4-pro", "glm-5.3", "glm-5.3-flash", "glm-5.3-flashx", "glm-5.2", "glm-5.1", "glm-5v-turbo", "glm-5-turbo", "glm-5", "kimi-k3", "kimi-k2.8-preview", "kimi-k2.7-code-highspeed", "kimi-k2.7-code", "kimi-k2.6", "kimi-k2.5", "minimax-m3", "minimax-m2.7", "minimax-m2.5", "qwen3.5-flash", "qwen3.5-plus", "mimo-v2.6-pro", "mimo-v2.6-flash", "mimo-v2.5-pro"])
export const tencentVision = new Set(["youtu-vita", "hy-vision-2.0-instruct", "hunyuan-t1-vision-20250916", "hunyuan-turbos-vision-video-20250728"])
export const tencentSeedream = new Set(["seedream-image-v5.0-pro", "seedream-image-v5.0-lite"])
export const tencentWand = new Set(["wand-vega-image-lite", "wand-vega-image-flash", "wand-vega-image-pro"])
export const tencentImage = new Set(["hy-image-v3", "hy-image-v3.5-preview", "vidu-image-q2", ...tencentWand, ...tencentSeedream])
export const byteSource = "https://docs.volcengine.com/docs/ark/model-list?lang=zh"
export const byteTextIds = ["doubao-seed-evolving", "doubao-seed-2-1-pro-260915", "doubao-seed-2-1-lite-260915", "doubao-seed-2-1-turbo-260628", "doubao-seed-2-1-pro-260628", "doubao-seed-2-0-lite-260428", "doubao-seed-2-0-mini-260428", "doubao-seed-2-0-pro-260215", "doubao-seed-2-0-lite-260215", "doubao-seed-2-0-mini-260215", "doubao-seed-2-0-code-preview-260215", "doubao-seed-character-260628", "doubao-seed-character-251128", "doubao-seed-translation-250915", "glm-5-3-flash-260828", "glm-5-2-260617", "deepseek-v4-1-flash-260910", "deepseek-v4-pro-ga-260813", "deepseek-v4-flash-ga-260731", "deepseek-v4-pro-260425"]
export const byteSingleOnly = new Set(["doubao-seedream-5-0-pro-260628", "doubao-seedream-5-0-flash-260915"])
export const byteSequential = new Set(["doubao-seedream-5-0-260128", "doubao-seedream-5-0-lite-260128", "doubao-seedream-4-5-251128", "doubao-seedream-4-0-250828"])
