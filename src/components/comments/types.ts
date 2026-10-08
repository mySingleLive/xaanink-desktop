/**
 * 行内评论功能共享类型(前端)。
 * 服务端 DTO 形状由 src/lib/services/text-comment.ts 序列化后与此一致。
 */

/** 评论挂载目标:章大纲 / 章正文 / 世界观介绍 / 设定大字段 / 候选稿正文 */
export type CommentTargetType = "CHAPTER_OUTLINE" | "CHAPTER_CONTENT" | "WORLD" | "SETTING" | "SCENE" | "CANDIDATE_CONTENT"

export type CommentStatus = "OPEN" | "AGREED" | "APPLIED" | "REJECTED"

export type CommentAuthorType = "USER" | "AI"

export interface CommentsTarget {
  targetType: CommentTargetType
  targetId: string
}

export interface TextCommentDTO {
  id: string
  novelId: string
  targetType: string
  targetId: string
  /** null = 顶层评论;回复指向顶层评论 id */
  parentId: string | null
  /** 以下锚点字段仅顶层评论有值 */
  quote: string | null
  prefix: string | null
  suffix: string | null
  startOffset: number | null
  endOffset: number | null
  authorType: CommentAuthorType
  authorId: string | null
  /** 快照:用户昵称 / "AI 评审员" */
  authorName: string
  /** Markdown 评论正文 */
  content: string
  status: CommentStatus
  /** 来源评审(AI 评审自动挂载时) */
  reviewId: string | null
  createdAt: string
  updatedAt: string
}

export interface TextCommentThread extends TextCommentDTO {
  replies: TextCommentDTO[]
}

/** 锚点已解析的线程(渲染用);anchor 为 null 即孤儿评论(原文已改动) */
export interface ResolvedThread {
  thread: TextCommentThread
  anchor: { start: number; end: number } | null
}

/** 创建评论的入参(客户端 → hook → API) */
export interface CreateCommentInput {
  /** 锚点原文（可选）：缺省 = 无锚点整体评论（评审视图「添加评论」允许只写意见） */
  quote?: string
  /** 选中时的原文快照，只在本地用于生成提交哈希，不传正文给 API。 */
  sourceText?: string
  anchorHash?: string
  startOffset?: number
  endOffset?: number
  content: string
}

/** CommentBubble 组件 props(由 MarkdownEditor 层绑定动作后渲染) */
export interface CommentBubbleProps {
  thread: TextCommentThread
  /** 锚点解析失败(原文已改动) */
  orphaned: boolean
  applying: boolean
  readOnly?: boolean
  /** 强制展示引用条（评审视图等无「原文高亮就在气泡上方」语境的地方必须开，否则看不到评论指向的段落） */
  showQuote?: boolean
  /** 提供时卡片头部渲染「收起」按钮（评审视图：已修改/已拒绝卡片从折叠态展开后可再折回） */
  onCollapse?: () => void
  onReply: (content: string) => Promise<void> | void
  onToggleReject: () => void
  onApply: () => void
  onApplyParagraph?: () => void
  onDelete: () => void
}

/** CommentComposer 组件 props(新评论输入气泡) */
export interface CommentComposerProps {
  /** 被选中的原文(随评论数据提交;不在输入框内展示) */
  quote: string
  anchor?: import("@/lib/comment-drafts").DraftAnchor
  threadId?: string
  draftTarget?: import("@/lib/comment-drafts").DraftTarget
  reply?: boolean
  submitting?: boolean
  onSubmit: (content: string) => Promise<void> | void
  onCancel: () => void
}
