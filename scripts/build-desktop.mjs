import './generate-routes.mjs'
import { build } from 'esbuild'
import {rmSync} from 'node:fs'
import {verifyCommandCatalogs} from './verify-command-catalogs.mjs'
await verifyCommandCatalogs()
// Generated entries from the withdrawn backup feature must not survive rebuilds.
for(const entry of ['service/application-restore-worker','preload/application-restore'])for(const suffix of ['.cjs','.cjs.map'])rmSync(`dist/${entry}${suffix}`,{force:true})
const common = { bundle: true, platform: 'node', target: 'node24', format: 'cjs', sourcemap: true, packages: 'external', define: { 'import.meta.url': '__desktopImportMetaUrl' }, banner: { js: 'var __desktopImportMetaUrl = require("node:url").pathToFileURL(__filename).href;' } }
await build({ ...common, entryPoints: ['desktop/main/index.ts'], outfile: 'dist/main/index.cjs' })
await build({ ...common, entryPoints: ['desktop/service/index.ts'], outfile: 'dist/service/index.cjs' })
await build({ bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['electron'], entryPoints: ['desktop/preload/index.ts'], outfile: 'dist/preload/index.cjs' })

await build({ bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['electron'], entryPoints: ['desktop/preload/maintenance.ts'], outfile: 'dist/preload/maintenance.cjs' })
await build({ bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['electron'], entryPoints: ['desktop/preload/root-relocation.ts'], outfile: 'dist/preload/root-relocation.cjs' })
