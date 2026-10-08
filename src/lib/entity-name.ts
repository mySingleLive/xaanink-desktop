const GENERIC_NAMES = new Set(["世界", "世界观", "设定", "角色", "人物", "主题", "属性", "大纲", "正文", "章节", "故事板", "金手指", "文风", "文风设定", "爽点", "泪点", "爽点/泪点", "等级体系", "力量体系", "概念体系", "势力", "势力分布", "社会环境", "人文环境", "地理环境", "地图", "世界地图"])
export function validEntityName(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0 && !/^(null|undefined|\[object Object\])$/i.test(value.trim()) }
export function specificEntityName(value: unknown): value is string { return validEntityName(value) && value.trim().length >= 2 && !GENERIC_NAMES.has(value.trim()) }
