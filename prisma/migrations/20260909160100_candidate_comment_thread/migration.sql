-- 回复也属于作者讨论状态；撤回不能越过后续回复/编辑。
ALTER TABLE "CandidateCommentEffect" ADD COLUMN "afterReplyHash" TEXT;
