import type {RecoveryTarget} from "./draft-recovery"
const known=new Set<RecoveryTarget["kind"]>(["NOVEL","THEME","WORLD","SETTING","CHARACTER","ITEM","SCENE","TROPE","ATTRIBUTE","FORESHADOW","CHAPTER_CONTENT","CHAPTER_OUTLINE","VOLUME_OUTLINE","CHAPTER_CANDIDATE","SUBAGENT","SCENARIO"])
const safeId=(id:unknown):id is string=>typeof id==="string"&&/^[A-Za-z0-9_-]{1,200}$/.test(id)
function record(value:unknown):Record<string,unknown>|null{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null}
/** Only existing, read-only local routes. Never dispatch a recovered request. */
export function createRecoveryVerifier(fetchLocal:typeof fetch,signal:AbortSignal): (target:RecoveryTarget)=>Promise<boolean>{
 const cache=new Map<string,Promise<Record<string,unknown>|null>>()
 const check=()=>{if(signal.aborted)throw new DOMException("草稿恢复已取消","AbortError")}
 const read=(path:string)=>{
  check();let pending=cache.get(path)
  if(!pending){pending=(async()=>{try{const response=await fetchLocal(path,{method:"GET",signal});check();if(!response.ok)return null;const body:unknown=await response.json();check();return record(body)}catch{check();return null}})();cache.set(path,pending)}
  return pending
 }
 return async target=>{
  check()
  if(!known.has(target.kind)||!safeId(target.novelId)||target.id!==undefined&&!safeId(target.id)||target.chapterId!==undefined&&!safeId(target.chapterId))return false
  const base=`/api/novels/${target.novelId}`,novel=record((await read(base))?.novel);check()
  if(novel?.id!==target.novelId||novel.status==="DELETED")return false
  if(target.kind==="NOVEL")return target.id===undefined||target.id===target.novelId
  if(target.kind==="THEME")return target.id===target.novelId
  if(!target.id)return false
  const owned=(value:unknown)=>{const row=record(value);return !!row&&row.id===target.id&&(row.novelId===undefined||row.novelId===target.novelId)}
  const collections:Partial<Record<RecoveryTarget["kind"],[string,string]>>={WORLD:["worlds","worlds"],CHARACTER:["characters","characters"],ITEM:["items","items"],TROPE:["tropes","tropes"],ATTRIBUTE:["attributes","definitions"],VOLUME_OUTLINE:["outline","volumes"]}
  const collection=collections[target.kind]
  if(collection){const body=await read(`${base}/${collection[0]}`);check();const rows=body?.[collection[1]];return Array.isArray(rows)&&rows.some(owned)}
  const details:Partial<Record<RecoveryTarget["kind"],[string,string]>>={SETTING:[`settings/${target.id}`,"setting"],SCENE:[`scenes/${target.id}`,"scene"],FORESHADOW:[`foreshadows/${target.id}`,"foreshadow"],CHAPTER_CONTENT:[`chapters/${target.id}`,"chapter"],CHAPTER_OUTLINE:[`chapters/${target.id}`,"chapter"],SCENARIO:[`scenarios/${target.id}`,"scenario"]}
  const detail=details[target.kind]
  if(detail){const body=await read(`${base}/${detail[0]}`);check();return owned(body?.[detail[1]])}
  if(target.kind==="CHAPTER_CANDIDATE"&&target.chapterId){const body=await read(`${base}/chapters/${target.chapterId}/candidates/${target.id}`);check();const candidate=record(body?.candidate);return owned(candidate)&&candidate?.chapterId===target.chapterId}
  // Original comment drafts carry targetId only. This existing GET calls
  // readTextTarget with the local author and work before returning threads.
  if(target.kind==="CHAPTER_CANDIDATE"){const body=await read(`${base}/comments?targetType=CANDIDATE_CONTENT&targetId=${target.id}`);check();return Array.isArray(body?.threads)}
  if(target.kind==="SUBAGENT"){const body=await read(`/api/subagent-runs/${target.id}`);check();const run=record(body?.run);return owned(run)&&run?.novelId===target.novelId}
  return false
 }
}
