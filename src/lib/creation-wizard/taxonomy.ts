/**
 * 创作向导分类法（起点/喜马拉雅式频道联动分类树），移植自 design/wizard-corpus/taxonomy.js（内容不变、加类型）。
 * 结构：频道（仅男频/女频）→ 篇幅 → 题材（按频道幻化）→ 题材子类（按题材幻化）；背景/风格/情节为独立标签组（风格按频道幻化）。
 */
export type WizardChannel = "男频" | "女频"
export type WizardLength = "微型" | "短篇" | "中篇" | "长篇"
export type WizardTagGroup = "sub" | "bg" | "style" | "flow"
export type WizardCategory = "theme" | "world" | "character" | "plot"

export interface WizardTemplate {
  id: string
  cat: WizardCategory
  title: string
  summary: string
  channels: string[]
  genres: string[]
  tags: string[]
  lengths?: string[]
  archetype?: string
  prompt: string
}

export const WIZARD_CHANNELS = ["男频", "女频"] as const

export const WIZARD_LENGTHS = ["微型", "短篇", "中篇", "长篇"] as const
export const WIZARD_LENGTH_META: Record<WizardLength, string> = {
  "微型": "1 万字以内",
  "短篇": "1-5 万字",
  "中篇": "5-30 万字",
  "长篇": "30 万字以上",
}

export const WIZARD_GENRES_BY_CHANNEL: Record<WizardChannel, readonly string[]> = {
  "男频": ["玄幻", "奇幻", "武侠", "仙侠", "都市", "历史", "军事", "游戏", "科幻", "悬疑", "灵异", "现实", "体育", "轻小说"],
  "女频": ["现代言情", "古风言情", "玄幻言情", "仙侠奇缘", "爱情悬疑", "浪漫青春", "纯爱", "现实", "轻小说"],
}

export const WIZARD_SUBGENRES: Record<string, readonly string[]> = {
  "玄幻": ["东方玄幻", "高武世界", "王朝争霸", "异世大陆", "太古洪荒"],
  "奇幻": ["西方奇幻", "剑与魔法", "史诗奇幻", "现代魔法", "蒸汽朋克"],
  "武侠": ["传统武侠", "武侠幻想", "国术无双", "江湖朝堂"],
  "仙侠": ["古典仙侠", "修真文明", "现代修真", "神话修真", "科技修仙"],
  "都市": ["都市生活", "都市异能", "商战职场", "娱乐明星", "青春校园"],
  "历史": ["架空历史", "秦汉三国", "隋唐大宋", "大明风云", "清史民国", "外国历史"],
  "军事": ["军旅生涯", "战争幻想", "抗战烽火", "谍战特工"],
  "游戏": ["虚拟网游", "电子竞技", "游戏异界", "游戏系统"],
  "科幻": ["星际文明", "时空穿梭", "未来世界", "末世危机", "进化变异", "超级科技", "赛博朋克"],
  "悬疑": ["诡秘悬疑", "侦探推理", "探险生存", "克苏鲁", "神秘幻想"],
  "灵异": ["恐怖惊悚", "风水秘术", "异闻传说"],
  "现实": ["时代叙事", "家庭伦理", "人间百态", "行业人生"],
  "体育": ["体育赛事", "篮球足球", "竞技人生"],
  "轻小说": ["原生幻想", "青春日常", "搞笑吐槽", "衍生同人"],
  "现代言情": ["都市情缘", "豪门世家", "婚恋职场", "娱乐星光", "重生逆袭"],
  "古风言情": ["宫闱宅斗", "女尊王朝", "穿越奇情", "古典架空", "朝堂权谋"],
  "玄幻言情": ["东方玄幻", "异族恋情", "仙侣奇缘"],
  "仙侠奇缘": ["古典仙侠", "现代修真", "三生三世"],
  "爱情悬疑": ["悬疑恋爱", "推理情缘"],
  "浪漫青春": ["青春校园", "青春疼痛", "青梅竹马"],
  "纯爱": ["现代纯爱", "古风纯爱", "幻想纯爱"],
}

export const WIZARD_BACKGROUNDS: readonly string[] = ["现代", "古代", "架空", "年代文", "民国", "未来", "星际", "末世", "异世界", "平行世界", "娱乐圈", "职场", "官场", "校园", "军旅", "三国", "大唐", "宋朝", "大明", "西方", "修仙界", "魔法世界"]

export const WIZARD_STYLES_BY_CHANNEL: Record<WizardChannel | "default", readonly string[]> = {
  "男频": ["爽文", "热血", "正剧", "励志", "轻松", "爆笑", "黑暗", "恐怖", "烧脑", "反套路", "慢热", "高燃", "开放式结局"],
  "女频": ["甜宠", "虐文", "治愈", "轻松", "正剧", "爆笑", "大女主", "爽文", "酸涩", "慢热", "意难平", "开放式结局"],
  "default": ["爽文", "正剧", "励志", "热血", "恐怖", "黑暗", "爆笑", "轻松", "治愈", "虐文", "甜宠", "大女主", "反套路", "烧脑", "慢热", "高燃", "酸涩", "意难平", "轻小说", "开放式结局"],
}

export const WIZARD_FLOWS: readonly string[] = ["升级流", "无敌流", "废柴流", "天才流", "签到流", "直播流", "系统流", "无限流", "诸天流", "快穿", "规则怪谈", "诡异复苏", "灵气复苏", "扮猪吃虎", "打脸", "逆袭", "复仇", "权谋", "宫斗", "基建", "经营", "探案", "马甲文", "追妻火葬场", "种田文", "退婚流", "重生", "穿越", "穿书", "囤货流"]

export const WIZARD_ARCHETYPES: Record<"男频" | "女频" | "通用", readonly string[]> = {
  "男频": ["特种兵", "兵王", "特工", "战神", "杀手", "神医", "赘婿", "神豪", "奶爸", "学霸", "程序员", "律师", "教师", "厨师", "道士", "剑修", "仙帝", "魔尊", "皇帝", "王爷", "县令", "捕快", "锦衣卫", "纨绔", "反派", "苟道中人", "大佬", "医生", "老师", "警察", "主播"],
  "女频": ["嫡女", "庶女", "长公主", "女帝", "太后", "王妃", "侯门千金", "穿书女配", "恶毒女配", "白月光", "替身", "团宠", "锦鲤", "农女", "绣娘", "医女", "仵作", "影卫", "影后", "顶流", "经纪人", "女强人", "大小姐", "制片人"],
  "通用": ["普通人", "反派视角", "非人主角", "群像"],
}

/** 两频道题材并集（男频序在前、女频专有在后），「不限」频道的题材列表 */
export const WIZARD_GENRE_UNION: readonly string[] = [
  ...new Set([...WIZARD_GENRES_BY_CHANNEL["男频"], ...WIZARD_GENRES_BY_CHANNEL["女频"]]),
]

/** 标签组 → 词表（tagGroupOf 反查用；style 组取 default 并集，与 design/wizard-corpus/validate.mjs 口径一致） */
export const WIZARD_TAG_GROUP_VOCABS: Record<WizardTagGroup, readonly string[]> = {
  sub: [...new Set(Object.values(WIZARD_SUBGENRES).flat())],
  bg: WIZARD_BACKGROUNDS,
  style: WIZARD_STYLES_BY_CHANNEL.default,
  flow: WIZARD_FLOWS,
}
