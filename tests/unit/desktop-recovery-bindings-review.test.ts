import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { transformSync } from "esbuild"
import { defaultState } from "../../desktop/core/settings"
import { DesktopSaveCoordinator } from "../../src/lib/desktop/save-coordinator"
import { restoreDesktopDraft, installRecoveryDraftSource } from "../../src/lib/desktop/draft-recovery"
import { installDesktopDraftSources } from "../../src/lib/desktop/draft-sources"
import { installWorkspaceDraftSource } from "../../src/lib/desktop/workspace-draft-source"
import { installCommentDraftSource } from "../../src/lib/desktop/comment-draft-source"
import { createRecoveryVerifier } from "../../src/lib/desktop/recovery-targets"
import { commentDraftStoreFor, commentDraftKey, commentDraftStorageKey } from "../../src/lib/comment-drafts"
import { emptyChatSession, chatSessionKey } from "../../src/lib/chat-session"
import { useChatStore } from "../../src/stores/chat"
import { useSceneUiStore } from "../../src/stores/scene-ui"
import { useStagedChangesStore } from "../../src/stores/staged-changes"
import { useTabsStore } from "../../src/stores/tabs"
import type { DraftSnapshot } from "../../desktop/shared/drafts"
import { ContentError } from "../../src/lib/content-errors"
import { createHash } from "node:crypto"
import { z } from "zod"

// Execute the current DesktopApp's actual two callback bodies against real
// renderer sources. Bootstrap/close ownership remains outside this harness.
const ast = ts.createSourceFile("DesktopApp.tsx", readFileSync("src/components/desktop/DesktopApp.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let callbacks: ts.ObjectLiteralExpression | undefined
function visit(node: ts.Node) {
  if (ts.isNewExpression(node) && node.expression.getText(ast) === "DesktopDraftSession" && node.arguments?.[2] && ts.isObjectLiteralExpression(node.arguments[2])) callbacks = node.arguments[2]
  ts.forEachChild(node, visit)
}
visit(ast); assert.ok(callbacks)
const props = callbacks.properties.filter((node): node is ts.PropertyAssignment => ts.isPropertyAssignment(node) && ["restore", "installSources"].includes(node.name.getText(ast)))
assert.equal(props.length, 2)
// Include the actual registration closure now shared by initialize/recovery.
let installBusinessSources:ts.VariableDeclaration|undefined
function registration(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==="installBusinessSources")installBusinessSources=node;ts.forEachChild(node,registration)}
registration(ast);assert.ok(installBusinessSources)
const code = transformSync(`const releases=[];let businessSourcesInstalled=false;const ${installBusinessSources.getText(ast)};export const options = {${props.map(node => node.getText(ast)).join(",")}}`, { loader: "ts", format: "cjs" }).code
const cache = new Map<string, string>(), storage = { getItem: (key: string) => cache.get(key) ?? null, setItem(key: string, value: string) { cache.set(key, value) }, removeItem(key: string) { cache.delete(key) } }
const comments = commentDraftStoreFor("local-author", () => storage)!
function fixture(restoreSession = true, fetchLocal: typeof fetch = async () => new Response(null, { status: 404 }), coordinator = new DesktopSaveCoordinator({ checkpointDelayMs: null })) {
  const original = { chat: useChatStore.getState(), scene: useSceneUiStore.getState(), staged: useStagedChangesStore.getState(), tabs: useTabsStore.getState() }
  cache.clear(); comments.prepareResetAfterCheckpoint().commit()
  useChatStore.setState({ accountId: "local-author", draft: "", conversationId: null, draftNovelId: null, pendingNovelTitle: null, pendingNovelPosition: null, pendingRequest: null, queuedMessages: [], draftAction: null, modelChoice: { modelId: null, effort: null }, modelChoiceExplicit: false, mode: "standard", modeExplicit: false })
  useSceneUiStore.setState({ drafts: {}, imageDrafts: {}, imageRequests: {}, submissions: {}, commitErrors: {}, action: null, reference: null })
  useStagedChangesStore.setState({ batches: {}, chips: [], sendRequest: null }); useTabsStore.setState({ tabs: [], activeTabId: null, subTabs: {}, panelFocus: null })
  const notifications: Array<{ text: string; action: { label: string; onClick(): void } }> = [], opened: boolean[] = []
  const module = { exports: {} as { options: { restore(snapshot: DraftSnapshot | null, signal: AbortSignal): Promise<(() => void) | undefined>; installSources(): () => void } } }
  const values = { alive: true, state: { settings: { ...defaultState.settings, general: { ...defaultState.settings.general, restoreSession } } }, storage, window: { fetch: fetchLocal }, setRecoveryOpen: (value: boolean) => opened.push(value), toast: { info: (text: string, options: { action: { label: string; onClick(): void } }) => notifications.push({ text, action: options.action }) }, restoreDesktopDraft, createRecoveryVerifier, desktopSaveCoordinator: coordinator, installDesktopDraftSources, installWorkspaceDraftSource, installRecoveryDraftSource, installCommentDraftSource }
  new Function("module", "exports", ...Object.keys(values), code)(module, module.exports, ...Object.values(values))
  return { options: module.exports.options, coordinator, notifications, opened, dispose() { useChatStore.setState(original.chat); useSceneUiStore.setState(original.scene); useStagedChangesStore.setState(original.staged); useTabsStore.setState(original.tabs) } }
}

test("REC56-B01: current DesktopApp restore callback uses original read-only target routes and returns preserved-data viewing action", async () => {
  const calls: Array<{ url: string; method?: string; body?: unknown }> = [], f = fixture(true, async (url, init) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body })
    if (url === "/api/novels/n") return Response.json({ novel: { id: "n" } })
    if (url === "/api/novels/n/comments?targetType=CANDIDATE_CONTENT&targetId=k") return Response.json({ threads: [] })
    return new Response(null, { status: 404 })
  })
  const target = { novelId: "n", targetType: "CANDIDATE_CONTENT", targetId: "k" }, row = { key: commentDraftKey(target), target, content: "原候选未发布意见", updatedAt: 1 }
  const snapshot: DraftSnapshot = { version: 1, revision: 1, createdAt: "2026-10-08T00:00:00Z", sources: { comments: { accountId: "local-author", rows: [row] } }, autosaves: [{ id: crypto.randomUUID(), draft: { request: "never replay" } }], issues: [] }
  try {
    assert.equal(await f.options.restore(snapshot, new AbortController().signal), undefined)
    assert.deepEqual(calls, [{ url: "/api/novels/n", method: "GET", body: undefined }, { url: "/api/novels/n/comments?targetType=CANDIDATE_CONTENT&targetId=k", method: "GET", body: undefined }])
    assert.equal(JSON.parse(cache.get(commentDraftStorageKey("local-author"))!)[0].content, row.content)
    assert.equal(f.notifications.length, 1); assert.equal(f.notifications[0].action.label, "查看草稿")
    f.notifications[0].action.onClick(); assert.deepEqual(f.opened, [true])
  } finally { f.dispose() }
})

test("REC56-B02: actual installSources binds all six renderer sources and tears them down, including partial registration failure", () => {
  const f = fixture()
  try {
    const release = f.options.installSources()
    assert.deepEqual(Object.keys(f.coordinator.exportSnapshot().sources).sort(), ["chat", "comments", "recovery", "scene", "staged", "workspace"])
    const before = f.coordinator.exportSnapshot().revision
    comments.set({ novelId: "n", targetType: "CHAPTER_CONTENT", targetId: "c" }, undefined, undefined, "绑定原评论store")
    assert.ok(f.coordinator.exportSnapshot().revision > before)
    release(); assert.deepEqual(f.coordinator.exportSnapshot().sources, {})
    const prior = f.coordinator.registerSource("workspace", { read: () => ({ sentinel: true }) })
    // A new bootstrap owns a fresh registration closure. The original closure
    // is intentionally idempotent after its one installation.
    const next = fixture(true, undefined, f.coordinator)
    try {
      assert.throws(() => next.options.installSources(), /DRAFT_SOURCE_ALREADY_REGISTERED/)
      assert.deepEqual(f.coordinator.exportSnapshot().sources, { workspace: { sentinel: true } })
    } finally { next.dispose(); prior() }
  } finally { f.dispose() }
})

test("REC56-B03: disabled restore callback returns deferred cleanup without clearing owned cache before the session caller checkpoints", async () => {
  const f = fixture(false), active = { ...emptyChatSession(), draft: "等待真实ACK" }, raw = JSON.stringify({ version: 1, activeKey: active.draftId, drafts: { [active.draftId]: active } })
  cache.set(chatSessionKey("local-author"), raw)
  try {
    const afterCheckpoint = await f.options.restore(null, new AbortController().signal)
    assert.equal(typeof afterCheckpoint, "function"); assert.equal(cache.get(chatSessionKey("local-author")), raw)
    const release = f.options.installSources()
    try { f.coordinator.configurePersistence(async () => {}); await f.coordinator.checkpointDrafts(); afterCheckpoint?.(); await f.coordinator.checkpointDrafts(); assert.equal(JSON.parse(cache.get(chatSessionKey("local-author"))!).drafts[JSON.parse(cache.get(chatSessionKey("local-author"))!).activeKey].draft, "") } finally { release() }
  } finally { f.dispose() }
})

test("REC56-T01: candidate comments without parent chapter traverse actual GET/readTextTarget ownership checks before returning threads", async () => {
  function declaration(path: string, name: string) {
    const text = readFileSync(path, "utf8"), source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
    const fn = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert.ok(fn); return fn.getText(source)
  }
  const targetCode = transformSync(declaration("src/lib/services/target-text.ts", "readTextTarget"), { loader: "ts", format: "cjs" }).code
  const routePath = "desktop/handlers/novels/[id]/comments/route.ts", text = readFileSync(routePath, "utf8"), routeAst = ts.createSourceFile(routePath, text, ts.ScriptTarget.Latest, true)
  const constants = routeAst.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(row => ["TARGET_TYPES", "querySchema"].includes(row.name.getText(routeAst)))).map(node => node.getText(routeAst)).join("\n")
  const routeCode = transformSync(constants + "\n" + declaration(routePath, "GET"), { loader: "ts", format: "cjs" }).code
  for (const mode of ["owned", "other-work", "other-author", "missing"] as const) {
    const reads: unknown[] = [], calls: string[] = []; let threadReads = 0
    const novel: Record<string, unknown> = { id: "n", userId: mode === "other-author" ? "foreign" : "local-author", status: "ACTIVE" }
    const candidate: Record<string, unknown> | null = mode === "missing" ? null : { id: "candidate", novelId: mode === "other-work" ? "different-work" : "n", content: "只读候选稿", updatedAt: new Date("2026-10-08T00:00:00Z") }
    const match = (row: Record<string, unknown> | null, where: Record<string, unknown>) => row && Object.entries(where).every(([key, value]) => key === "status" && value && typeof value === "object" && "not" in value ? row[key] !== value.not : row[key] === value)
    const prisma = {
      novel: { findFirst: async (query: { where: Record<string, unknown> }) => { reads.push(query.where); return match(novel, query.where) ? novel : null } },
      contentCandidate: { findFirst: async (query: { where: Record<string, unknown> }) => { reads.push(query.where); return match(candidate, query.where) ? candidate : null } },
    }
    const targetModule = { exports: {} as { readTextTarget: (...args: unknown[]) => Promise<unknown> } }
    new Function("module", "exports", "ContentError", "contentHash", targetCode)(targetModule, targetModule.exports, ContentError, (text: string) => createHash("sha256").update(text).digest("hex"))
    const routeModule = { exports: {} as { GET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } }
    new Function("module", "exports", "z", "NextResponse", "getOwnedNovel", "readTextTarget", "prisma", "listThreads", "toErrorResponse", routeCode)(routeModule, routeModule.exports, z, { json: Response.json }, async () => ({ session: { user: { id: "local-author" } } }), targetModule.exports.readTextTarget, prisma, async () => { threadReads++; return [] }, (error: ContentError) => Response.json({ error: error.code }, { status: error.status }))
    const controller = new AbortController(), verifier = createRecoveryVerifier(async (url, init) => {
      assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); const path = String(url); calls.push(path)
      if (path === "/api/novels/n") return Response.json({ novel: { id: "n" } })
      return routeModule.exports.GET(new Request("http://isolated" + path), { params: Promise.resolve({ id: "n" }) })
    }, controller.signal)
    assert.equal(await verifier({ novelId: "n", kind: "CHAPTER_CANDIDATE", id: "candidate" }), mode === "owned")
    assert.deepEqual(calls, ["/api/novels/n", "/api/novels/n/comments?targetType=CANDIDATE_CONTENT&targetId=candidate"])
    assert.equal(threadReads, mode === "owned" ? 1 : 0)
    assert.deepEqual(reads[0], { id: "n", userId: "local-author", status: { not: "DELETED" } })
    if (mode !== "other-author") assert.deepEqual(reads[1], { id: "candidate", novelId: "n" })
  }
})
