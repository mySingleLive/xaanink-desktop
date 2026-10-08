import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {commandCatalogSources} from './command-catalog-sources.mjs'
export async function verifyCommandCatalogs(){
 const catalog=JSON.parse(await readFile('desktop/shared/command-catalogs.generated.json','utf8'))
 if(catalog.schemaVersion!==1)throw Error('Unsupported command catalog. Run npm run generate:commands.')
 const version=JSON.parse(await readFile('node_modules/monaco-editor/package.json','utf8')).version
 if(catalog.monacoVersion!==version)throw Error('Command catalog Monaco version differs. Run npm run generate:commands.')
 for(const file of commandCatalogSources)if(catalog.sourceHashes?.[file]!==createHash('sha256').update(await readFile(file)).digest('hex'))throw Error(`Stale installed command catalog (${file}). Run npm run generate:commands.`)
 const text=value=>typeof value==='string'&&value.length>0&&value.length<=8192
 for(const platform of ['darwin','win32']){
  const value=catalog.platforms?.[platform],commands=value?.commands
  if(value?.resolved!==true||!Array.isArray(commands)||commands.length<200||commands.length>10000||new Set(commands.map(row=>row?.id)).size!==commands.length)throw Error(`Incomplete ${platform} command catalog. Run npm run generate:commands.`)
  for(const row of commands){
   if(!row||![row.id,row.label,row.group].every(text)||!['global','text','markdown','composer','input'].includes(row.scope)||typeof row.locked!=='boolean'||!Array.isArray(row.defaults)||!row.defaults.every(text)||row.contexts!==undefined&&(!row.contexts||Array.isArray(row.contexts)||typeof row.contexts!=='object'||Object.values(row.contexts).some(v=>typeof v!=='boolean'))||row.monacoId!==undefined&&!text(row.monacoId)||row.monacoBindings!==undefined&&(!Array.isArray(row.monacoBindings)||row.monacoBindings.some(b=>!b||!text(b.binding)||b.when!==null&&!text(b.when)||!Number.isFinite(b.weight)||!Number.isFinite(b.secondaryWeight))))throw Error(`Invalid ${platform} command catalog. Run npm run generate:commands.`)
  }
  if(value.sha256!==createHash('sha256').update(JSON.stringify(commands)).digest('hex'))throw Error(`Corrupt ${platform} command catalog. Run npm run generate:commands.`)
 }
 return catalog
}
