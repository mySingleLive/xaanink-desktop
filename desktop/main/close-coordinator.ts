export type CloseIntent = "window" | "quit"
export interface CloseOwner { owner: number; sessionId: string }
export interface CloseServices {
 current(): CloseOwner | null
 busy(): Promise<boolean>
 confirmStop(): Promise<boolean>
 stopTasks(): Promise<void>
 flush(owner: CloseOwner, retryFailures: boolean): Promise<void>
 closeData(): Promise<void>
 /** A previous handoff may have switched storage. Never flush its old renderer again. */
 closedHandoffPending?(): boolean
 afterClose?(): Promise<void>
 failed(): Promise<"retry" | "export" | "cancel">
 exportDraft(owner: CloseOwner): Promise<void>
 commit(intent: CloseIntent): void | Promise<void>
 release(): void | Promise<void>
}
/** One close flow owns its renderer lifetime until it commits or cancels. */
export class CloseCoordinator {
 private flight: Promise<boolean> | null = null
 private intent: CloseIntent = "window"
 constructor(private services: CloseServices) {}
 request(intent: CloseIntent): Promise<boolean> {
  if (this.flight) { if (intent === "quit") this.intent = "quit"; return this.flight }
  this.intent = intent
  // Set flight before any synchronous observer/callback can request again.
  const work = Promise.resolve().then(() => this.run())
  this.flight = work
  void work.finally(() => { if (this.flight === work) this.flight = null })
  return work
 }
 private async run(): Promise<boolean> {
  const initial = this.services.current(), owner = initial ? {...initial} : null
  const current = () => { const now = this.services.current(); return owner ? now?.owner === owner.owner && now.sessionId === owner.sessionId : now === null }
  try {
   let dataClosed=this.services.closedHandoffPending?.()??false
   if (!dataClosed && await this.services.busy() && !await this.services.confirmStop()) return false
   if (!current()) return false
   let retry = false, stopped = false
   for (;;) {
    try {
     if (!dataClosed && !stopped) { await this.services.stopTasks(); stopped = true }
     if (!current()) return false
     if (!dataClosed && owner) await this.services.flush(owner, retry)
     if (!current()) return false
     if (!dataClosed) {await this.services.closeData();dataClosed=true}
     await this.services.afterClose?.()
     if (!current()) return false
     const committedIntent=this.intent
     await this.services.commit(committedIntent)
     // On Windows the last window emits before-quit synchronously from close.
     // A promoted request cannot be satisfied by a window-only commit.
     if(committedIntent==="window"&&this.intent==="quit"){
      const after=this.services.current()
      if(after&&(!owner||after.owner!==owner.owner||after.sessionId!==owner.sessionId))return false
      await this.services.commit("quit")
     }
     return true
    } catch {
     if (!current()) return false
     for (;;) {
      const choice = await this.services.failed()
      if (!current() || choice === "cancel") return false
      if (choice === "retry") { retry = true; break }
      if (owner) { try { await this.services.exportDraft(owner) } catch { /* Retain the failed close and offer retry/export/cancel again. */ } }
     }
    }
   }
  } catch { return false }
  finally { try { await this.services.release() } catch { /* Close ownership must still be released after UI disposal. */ } }
 }
}
