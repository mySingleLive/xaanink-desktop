import { readFile, writeFile } from 'node:fs/promises'
const map = JSON.parse(await readFile(new URL('../docs/migration-map.json', import.meta.url), 'utf8'))
const rows = map.routes.filter(row => row.disposition !== 'excluded-platform')
let output = '// Generated from the reviewed migration map; never from the parent repository.\n'
output += 'export type WorkspaceScope = "global" | "novel" | "chat" | "conversation" | "conversations" | "turn" | "subagent";\nexport interface Route { scope: WorkspaceScope; path: string; methods: string[]; load: () => Promise<unknown> }\nexport const routes: Route[] = [\n'
for (const row of rows) {
  const path = row.path.replace('src/app', '').replace('/route.ts','')
  const scope = path.startsWith('/api/admin/') || ['/api/novels', '/api/models', '/api/image-models', '/api/generate/test'].includes(path) ? 'global'
    : path.startsWith('/api/novels/[id]') ? 'novel'
    : path === '/api/chat' ? 'chat'
    : path === '/api/chat/conversations' ? 'conversations'
    : path.startsWith('/api/chat/conversations/[id]') ? 'conversation'
    : path.startsWith('/api/chat/turns/[turnId]') ? 'turn'
    : path === '/api/subagent-runs/[id]' ? 'subagent' : null
  if (!scope) throw new Error('An explicit workspace scope is required for ' + path)
  output += `  { scope: ${JSON.stringify(scope)}, path: ${JSON.stringify(path)}, methods: ${JSON.stringify(row.methods)}, load: () => import(${JSON.stringify('../handlers/' + row.local.replace('desktop/handlers/', '').replace(/\.ts$/, ''))}) },\n`
}
output += ']\n'
await writeFile(new URL('../desktop/service/routes.generated.ts', import.meta.url), output)
