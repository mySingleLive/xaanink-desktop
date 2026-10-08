/** Stops admission before draining real work; a boolean alone is not a flush. */
export class BusinessGate {
 private accepting=true
 private pending=new Set<Promise<unknown>>()
 private drain:Promise<void>|null=null
 private draining=false
 get closed(){return !this.accepting}
 run<T>(operation:()=>Promise<T>):Promise<T>{
  if(!this.accepting)return Promise.reject(Error('BUSINESS_CLOSED'))
  const work=Promise.resolve().then(operation)
  this.pending.add(work)
  void work.then(()=>this.pending.delete(work),()=>this.pending.delete(work))
  return work
 }
 close():Promise<void>{
  if(this.drain)return this.drain
  this.accepting=false;this.draining=true
  this.drain=Promise.allSettled([...this.pending]).then(()=>{this.draining=false})
  return this.drain
 }
 reopen(){
  if(this.draining)throw Error('BUSINESS_DRAINING')
  this.accepting=true;this.drain=null
 }
}
