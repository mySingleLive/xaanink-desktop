import {gunzip} from 'node:zlib'
import {promisify} from 'node:util'
import {safeRelative} from '../../core/root-ownership'
const unzip=promisify(gunzip),MAX_EXPANDED=512*1024*1024
function octal(bytes:Buffer){const value=bytes.toString('ascii').replace(/\0.*$/s,'').trim();if(!/^[0-7]+$/.test(value))throw Error('备份归档数值无效');const parsed=parseInt(value,8);if(!Number.isSafeInteger(parsed))throw Error('备份归档数值过大');return parsed}
function text(bytes:Buffer){const zero=bytes.indexOf(0);if(zero>=0&&bytes.subarray(zero).some(b=>b!==0))throw Error('备份归档文本无效');return bytes.subarray(0,zero<0?undefined:zero).toString('utf8')}
/** Preflight before PGlite's virtual filesystem importer sees an untrusted tar.
 * Only ordinary entries emitted by our pinned engine are supported; no links,
 * PAX/GNU names, duplicate paths, parent traversal or unbounded decompression.
 */
export async function validateEngineArchive(input:Uint8Array,postgresMajor:number):Promise<Buffer>{
 if(input.byteLength<2||input[0]!==0x1f||input[1]!==0x8b)throw Error('备份数据库归档格式无效')
 const bytes=await unzip(input,{maxOutputLength:MAX_EXPANDED})
 if(bytes.length<1024||bytes.length%512)throw Error('备份归档长度无效')
 let offset=0,ended=false,version:string|undefined;const entries=new Map<string,'file'|'directory'>(),parents=new Set<string>()
 while(offset<bytes.length){
  const header=bytes.subarray(offset,offset+512)
  if(header.every(b=>b===0)){if(bytes.length-offset<1024||bytes.subarray(offset).some(b=>b!==0))throw Error('备份归档尾部无效');ended=true;break}
  const checksum=octal(header.subarray(148,156)),sum=header.reduce((total,byte,index)=>total+(index>=148&&index<156?32:byte),0)
  if(sum!==checksum)throw Error('备份归档头校验失败')
  // Pinned tinytar uses a 131-byte prefix followed by atime/ctime fields.
  const raw=text(header.subarray(0,100)),prefix=text(header.subarray(345,476)),type=header[156]
  if(prefix||![0,48,53].includes(type)||text(header.subarray(157,257)))throw Error('备份归档含不支持的条目')
  // PGlite's pinned exporter prefixes names with exactly one slash.
  const name=raw.startsWith('/')?raw.slice(1):raw
  if(!safeRelative(name)||entries.has(name)||entries.size>=25000)throw Error('备份归档路径无效或重复')
  const size=octal(header.subarray(124,136)),directory=type===53
  if(directory&&size!==0||size>MAX_EXPANDED||offset+512+size>bytes.length)throw Error('备份归档条目长度无效')
  const parts=name.split('/');for(let index=1;index<parts.length;index++){const parent=parts.slice(0,index).join('/');if(entries.get(parent)==='file')throw Error('备份归档父路径不是目录');parents.add(parent)}
  if(!directory&&parents.has(name))throw Error('备份归档路径冲突')
  entries.set(name,directory?'directory':'file')
  if(name==='PG_VERSION'){if(directory||size>16)throw Error('备份数据库版本无效');version=bytes.subarray(offset+512,offset+512+size).toString('ascii').trim()}
  const end=offset+512+size,next=offset+512+Math.ceil(size/512)*512
  if(bytes.subarray(end,next).some(b=>b!==0))throw Error('备份归档填充无效')
  offset=next
 }
 if(!ended||version!==String(postgresMajor))throw Error('备份数据库引擎版本不匹配')
 return bytes
}
