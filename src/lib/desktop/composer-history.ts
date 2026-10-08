interface HistoryEntry {values:string[];position:number|null;draft:string}
export class ComposerHistory {
 private entries=new Map<string,HistoryEntry>()
 constructor(private limit=50){}
 seed(key:string,values:string[]){if(!this.entries.has(key)){this.entries.set(key,{values:[],position:null,draft:""});for(const value of values)this.remember(key,value)}}
 remember(key:string,value:string){
  if(!value.trim())return
  const entry=this.entries.get(key)??{values:[],position:null,draft:""}
  if(entry.values.at(-1)!==value)entry.values=[...entry.values,value].slice(-this.limit)
  entry.position=null;entry.draft="";this.entries.set(key,entry)
  if(this.entries.size>100)this.entries.delete(this.entries.keys().next().value!)
 }
 move(key:string,direction:-1|1,current:string):string{
  const entry=this.entries.get(key)
  if(!entry?.values.length)return current
  if(entry.position!==null&&entry.values[entry.position]!==current){entry.position=null;entry.draft=current}
  if(entry.position===null){if(direction===1)return current;entry.draft=current;entry.position=entry.values.length-1}
  else if(direction===1&&entry.position===entry.values.length-1){entry.position=null;return entry.draft}
  else entry.position=Math.max(0,Math.min(entry.values.length-1,entry.position+direction))
  return entry.values[entry.position]
 }
}
