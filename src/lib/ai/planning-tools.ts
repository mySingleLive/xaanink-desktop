import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { getPlanning, pendingPlanningProposals, proposePlanning, applyPlanningProposal } from "@/lib/services/planning";
import {
  chapterProjection,
  operationSchema,
  planningSchema,
} from "@/lib/planning/domain";
import { currentChatExecution } from "@/lib/chat-execution";
import { requestHash } from "@/lib/services/content-commit";
import type { StoryScope } from "@/lib/services/story-artifacts";

export function createPlanningTools(scope: StoryScope): ToolSet {
  const run = async (action: () => Promise<unknown>) => {
    try {
      return { ok: true, result: await action() };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "规划操作失败，已保存版本保留",
      };
    }
  };
  return {
    getNovelPlanning: tool({
      description:
        "读取世界线（客观事实、时间、时期、分叉和真实穿越连接）、叙事线（大纲/细纲树、多角色独立讲述与有限披露）、卷章字数预算、待采用提案（pendingProposals）和版本。worlds是世界线集合，lines是叙事线集合，两者不可混用；events[].line引用worlds[].id，cards[].line引用lines[].id。时间value/end/duration统一为小时，precision不改变单位；持续事件用exact起点+duration，window仅表示起点不确定。修改前必须读取ID与版本。includeSchema=true返回创建字段规范。大纲是叙事线分章投影，禁止用旧大纲写工具绕过。",
      inputSchema: z.object({ includeSchema: z.boolean().default(false) }),
      execute: ({ includeSchema }) =>
        run(async () => ({
          ...(await getPlanning(scope)),
          pendingProposals: await pendingPlanningProposals(scope),
          conventions: {
            execution: "采用提案、读取新状态、提出下一份建议是有先后依赖的真实工具调用。先等待applyNovelPlanningProposal成功回执，再单独调用getNovelPlanning读取已保存版本，最后才调用proposeNovelPlanning；不得并行、预估版本加一，或仅在文字中声称已调用/已落库。",
            worlds: "世界线。worldId可关联getWorlds返回的已建世界实体ID；不是另建世界观实体。",
            lines: "叙事线；只在铺陈讲述顺序时创建。事件line引用worlds.id，卡片line引用lines.id，tellings.refs.line也引用worlds.id。",
            time: "统一为小时：第30天value=720，持续90天duration=2160。precision=day/year只是显示精度。父事件用exact+duration包含子事件；window是发生时刻不确定范围，不是持续区间。",
            materials: "事件和telling的materialRefs引用本书已有setting/item/scene/foreshadow档案：kind、id、role、note；普通资料role=use，伏笔role=plant/mention/payoff。先建伏笔再规划；首次埋入须同一telling.refs引用的世界事件也有同一伏笔plant，事件note记客观安排、telling.note仅写本次可见线索。未来提及/回收可按需补，不能把规划引用登记成正文触点。",
            narrative: "卡片树按读者讲述顺序展开，不照搬世界事件发生顺序；回忆/预叙须明确标记并有回到当前场景的衔接。refs.reveal只写本次视角确实获知、允许读者知道的内容，不能复制含凶手身份的客观事实后又在withheld声称隐藏身份。narrateSummary=false的父卡只组织层级，其事实不会自动成为正文；必要情节须进入实际讲述的叶卡。分章前按目标章数细化行动卡，不能把少量摘要硬拆成无内容章节。进入正文的章（卷章大纲已分章）每张实际讲述卡的每个视角必须带 beats 段落节拍：按段落顺序逐拍给出 type（事件/人物/环境/回忆/心理/分析/对话/动作/感受/过渡）与 summary（这一段写什么，具体到人、事、信息点），粒度约每300-400字一拍；章节拍总数应覆盖该章字数范围，生成正文前 checkChapterNarrative 会检查节拍是否足够。",
          },
          ...(includeSchema ? { schema: z.toJSONSchema(planningSchema) } : {}),
        })),
    }),
    getNarrativeChapter: tool({
      description:
        "查询章节来自哪些实际叙事卡片、各视角本次披露/暂不披露和写作字数范围（wordMin下限、wordBudget上限）。纯汇总父卡不重复计数。正文仅讲本次披露，不能把共享事实或隐瞒内容提前揭露。",
      inputSchema: z.object({ chapterId: z.string() }),
      execute: ({ chapterId }) =>
        run(async () => {
          const p = await getPlanning(scope);
          return {
            version: p.version,
            ...chapterProjection(p.data, chapterId),
          };
        }),
    }),
    proposeNovelPlanning: tool({
      description:
        "提出世界线/叙事线的创建、修改、删除、归组、移动、复制、分叉建议。put按ID创建或合并指定字段，delete受引用保护；line是所属线ID，parent是同线父卡/事件ID。先getNovelPlanning(includeSchema=true)。新对象指定稳定唯一ID。一次批次可同时建立线、事件、引用卡与卷章；有依赖关系的对象（如世界线与挂载其上的事件）必须放同一批次，不得拆成前后两个提案。tellings是独立角色视角，每个含intent/reliability/refs的reveal和withheld。事实尚未确定时写建议，不能伪造既定事实。expectedVersion须来自查询。建议通过与UI相同的树/时间/预算校验并保存候选，随后必须同轮用 askUserQuestion 请作者确认，作者明确同意后调用 applyNovelPlanningProposal 落入作品。不能宣称建议已成为正式内容，也不能让作者去面板操作。",
      inputSchema: z.object({
        expectedVersion: z.number().int().nonnegative().describe("来自最近一次真实getNovelPlanning回执。若本轮还要采用上一提案，先实际调用并等待apply成功，再重新读取；不能预估旧版本+1。"),
        operations: z.array(operationSchema).min(1).max(200),
      }),
      execute: (input, options) =>
        run(() =>
          proposePlanning(scope, {
            ...input,
            operationId: requestHash({
              execution:
                currentChatExecution()?.operationId || options.toolCallId,
              input,
            }),
          }),
        ),
    }),
    applyNovelPlanningProposal: tool({
      description:
        "采用一份已保存的世界线/叙事线规划提案（proposalId 来自 proposeNovelPlanning 回执的 id 或 getNovelPlanning 的 pendingProposals）。只能在作者明确同意后采用：先经 askUserQuestion 确认或作者消息明确同意采用，未确认不得采用。必须真正执行本工具并等待成功回执，才能说已采用；普通回复中的调用描述不会执行。后续修改须在成功后单独getNovelPlanning读取新版本，不能同时提出依赖此次采用的新提案、不能预估版本加一。采用后按返回报告实际版本与变更要点；与面板采用共用幂等回执，重复采用同一提案安全（内容不变返回原版本）。",
      inputSchema: z.object({
        proposalId: z.string().min(1).describe("提案ID（ContentVersion 行 id）"),
      }),
      execute: ({ proposalId }) =>
        run(() => applyPlanningProposal(scope, proposalId)),
    }),
  };
}
