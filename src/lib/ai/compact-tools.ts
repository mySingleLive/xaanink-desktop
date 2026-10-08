import { tool, type ToolSet } from "ai"
import { z } from "zod"
import { estimateToolTokens } from "./prompt-budget"

const CORE = ["getNovelPlanning", "getNarrativeChapter", "proposeNovelPlanning", "applyNovelPlanningProposal", "askUserQuestion", "proposePlan", "startNovelFromChat", "getStoryWorkflow", "getStoryArtifact", "updateStoryWorkflow", "reviewStoryCheckpoint", "requestStoryApproval", "completeStoryTask", "loadCreationTools"]

/** 小上下文模型按需启用同一批已鉴权工具，不把全部参数schema一次塞进请求。 */
export function compactCreationTools(available: ToolSet, budget: number, descriptionLength = 48) {
  let selected: string[] = []
  const catalog = Object.entries(available).map(([name, spec]) => `${name}：${(typeof spec.description === "string" ? spec.description : "").replace(/\s+/g, " ").slice(0, descriptionLength)}`).join("\n")
  const tools: ToolSet = { ...available }
  const activeTools = () => [...new Set([...CORE.filter(name => tools[name]), ...selected])]
  const activeSet = (names = activeTools()) => Object.fromEntries(names.map(name => [name, tools[name]]))
  const prime = async (names: string[]) => {
    for (const name of names) {
      if (!Object.hasOwn(available, name) || activeTools().includes(name)) continue
      const next = [...activeTools(), name]
      if (await estimateToolTokens(activeSet(next)) <= budget) selected.push(name)
      if (selected.length >= 8) break
    }
  }
  tools.loadCreationTools = tool({
    description: `按需启用创作工具：从目录选择接下来需要的工具名（最多8个）。成功后下一步可用，替换上一次选择（未再选中的工具立即不可调用，误调会失败）；不改变权限和审批。若参数总量过大，减少同时启用的工具。当前模式目录：\n${catalog}`,
    inputSchema: z.object({ names: z.array(z.string().min(1)).min(1).max(8) }),
    execute: async ({ names }) => {
      const unknown = names.filter(name => !Object.hasOwn(available, name))
      if (unknown.length) return { ok: false, message: "这些工具不在当前模式的目录中", unknown }
      const next = [...new Set([...CORE.filter(name => tools[name]), ...names])]
      if (await estimateToolTokens(activeSet(next)) > budget) return { ok: false, message: "同时启用的工具参数超过本模型预算，请一次选择更少的工具", requested: names }
      selected = [...new Set(names)]
      return { ok: true, activeTools: activeTools(), message: "工具已启用，请在下一步调用；未列出的工具可随时重新选择" }
    },
  })
  const instruction = () => `\n【剧情与大纲】新剧情使用世界线记录客观事实、叙事线组织大纲细纲和多角色有限披露；先 getNovelPlanning。规划修改用 proposeNovelPlanning 保存候选，同轮 askUserQuestion 请作者确认后调 applyNovelPlanningProposal 落入作品；不得让作者去面板采用。大纲是卷章投影；写作前 getNarrativeChapter 读取字数上限，暂不披露内容不得写进正文。\n【工具按需加载】当前可调用：${activeTools().join("、")}。想执行的工具若不在当前列表，先调用 loadCreationTools({names:["准确工具名"]})，成功后下一步调用该工具。完整目录在 loadCreationTools 的说明中。读取产物不等于修改；updateSopPlan/updateStoryWorkflow 只同步计划与创作简报，不能修改叙事线、角色、世界或设定，不要用它们替代真正的内容写入工具。`
  return { tools, activeTools, activeSet, prime, instruction }
}
