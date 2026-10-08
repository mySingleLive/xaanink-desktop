/**
 * 角色头像/立绘的文生图提示词拼装（纯 TS，无服务端依赖，客户端面板与对话工具共用）。
 *
 * 这里是「画面像不像这本书里的人」的唯一权威来源：除了角色自身的外貌服饰，
 * 还必须把**作品的时代与画风语境**带进去——否则同一段「黑发年轻男子」描述，
 * 模型可能给出现代写真或日系二次元，与蒸汽时代西幻小说的人物形象天差地别。
 */

export type CharacterImageKindKey = "avatar" | "portrait"

export interface ImagePromptProfile {
  name: string
  age?: string
  gender?: string
  occupation?: string
  personality?: string
  appearance: string
  /** 基础生理属性：有则拼进外貌段（立绘全身像尤其需要身高/身材） */
  height?: string
  weight?: string
  build?: string
  faceShape?: string
  clothing: string
  /** 行为习惯（含标志性动作）：立绘取姿态参考 */
  habits?: string
}

/** 画面语境：由小说主题/文风推导，决定时代氛围与画风 */
export interface ImagePromptContext {
  /** 时代与世界氛围，如「19 世纪末蒸汽与机械时代的西式都市，煤气路灯与雾气」 */
  era?: string
  /** 画风，如「写实厚涂油画」「日系赛璐璐动画」 */
  artStyle?: string
}

/**
 * 各类型图像的候选画布尺寸（头像正方、立绘竖版 2:3），按优先级从高到低。
 * 各家文生图模型对 size 的约束差异很大——Seedream 要求不低于约 3.7MP（2K 档），
 * OpenAI gpt-image 只认 1024 档的三个固定值——所以给一串候选逐个降级尝试，
 * 全部被拒时再退回模型默认尺寸（会丢比例，但至少能出图）。
 */
export const IMAGE_SIZE_CANDIDATES: Record<CharacterImageKindKey, readonly string[]> = {
  avatar: ["2048x2048", "1024x1024"],
  portrait: ["1664x2496", "1024x1536"],
}

const COMPOSITION: Record<CharacterImageKindKey, string> = {
  avatar:
    "正方形构图的人物肖像特写，头部与肩部入镜，面部占画面主体，五官清晰可辨，视线朝向观众",
  portrait:
    "竖版全身立绘，画面比例 2:3，单人全身站姿，从头到脚完整入镜，服装与鞋履细节完整，背景简洁干净不抢主体",
}

/** 默认画风：偏写实的书籍插画，比「插画」泛指更稳定 */
const DEFAULT_ART_STYLE = "写实风格人物插画，厚涂油画质感"

const QUALITY = "细腻的五官与材质刻画，光影层次分明，电影级布光，高清高质量"

/** 反向约束：文生图模型对「不要」类指令响应有限，但能显著降低出现概率 */
const GUARD =
  "画面中不要出现任何文字、字幕、水印或 logo；只画一个人物，不要多人、不要分镜分格；不要给人物添加描述中未提及的配饰（尤其是眼镜、单片眼镜、胡须、疤痕、耳环）"

/**
 * 关键特征保真：发型发色、瞳色、眼镜/胡须/单片眼镜这类面部配饰是识别角色的锚点，
 * 文生图模型最容易在这些小地方自由发挥（黑发画成棕发、丢眼镜、加胡须），显式钉死。
 */
const FIDELITY =
  "人物的发型与发色、眼睛颜色、年龄感、以及眼镜/胡须/伤疤/单片眼镜等面部配饰，必须与人物描述严格一致——这些是识别角色的关键特征，不可遗漏、不可更改、不可自行添加"

function clean(value?: string): string {
  return (value ?? "").trim()
}

/**
 * 拼装完整提示词。顺序固定为：
 * 构图 → 时代语境 → 人物身份 → 外貌 → 服饰 → 神态/姿态 → 画风 → 质量 → 反向约束。
 * 文生图模型对前置 token 更敏感，构图与时代放在最前面。
 */
export function buildCharacterImagePrompt(
  kind: CharacterImageKindKey,
  profile: ImagePromptProfile,
  context: ImagePromptContext = {}
): string {
  const segments: string[] = [COMPOSITION[kind]]

  const era = clean(context.era)
  if (era) segments.push(`时代与世界背景：${era}`)

  const identity = [clean(profile.gender), clean(profile.age), clean(profile.occupation)]
    .filter(Boolean)
    .join("，")
  segments.push(identity ? `人物：${clean(profile.name)}，${identity}` : `人物：${clean(profile.name)}`)

  const appearanceParts = [
    clean(profile.faceShape) && `脸型${clean(profile.faceShape)}`,
    clean(profile.build),
    clean(profile.height) && `身高 ${clean(profile.height)}`,
    clean(profile.weight) && `体重 ${clean(profile.weight)}`,
    clean(profile.appearance),
  ].filter(Boolean)
  if (appearanceParts.length > 0) segments.push(`外貌：${appearanceParts.join("，")}`)

  // 服饰里列到的配件（礼帽、手杖、佩枪）最容易被模型丢掉，显式点名要求逐件出现
  const clothing = clean(profile.clothing)
  if (clothing) segments.push(`服饰（以下每一件都要画出来，不可遗漏）：${clothing}`)

  // 头像看神态，立绘看姿态：两者取材不同，避免头像里塞一个用不上的全身动作
  if (kind === "avatar") {
    const personality = clean(profile.personality)
    if (personality) segments.push(`神态气质：${personality}`)
  } else {
    const habits = clean(profile.habits)
    if (habits) segments.push(`姿态参考其行为习惯与标志性动作：${habits}`)
  }

  segments.push(clean(context.artStyle) || DEFAULT_ART_STYLE, FIDELITY, QUALITY, GUARD)

  return segments.join("。").replace(/。+/g, "。")
}

/**
 * 把模型自己写的一段提示词补上构图/画风/质量/反向约束。
 * 对话里模型对角色理解最深，提示词让它写；但构图与画风这类硬约束由平台兜底，
 * 免得模型只写了人物描述，导致立绘出成正方形大头照。
 */
export function decorateImagePrompt(
  kind: CharacterImageKindKey,
  rawPrompt: string,
  context: ImagePromptContext = {}
): string {
  const body = clean(rawPrompt)
  const segments = [COMPOSITION[kind]]
  const era = clean(context.era)
  if (era) segments.push(`时代与世界背景：${era}`)
  segments.push(body, clean(context.artStyle) || DEFAULT_ART_STYLE, FIDELITY, QUALITY, GUARD)
  return segments.join("。").replace(/。+/g, "。")
}
