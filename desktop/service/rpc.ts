import { randomUUID } from "node:crypto"
export interface RpcPort { postMessage(value: unknown): void; on(event: "message", listener: (message: unknown) => void): unknown; removeListener?(event: "message", listener: (message: unknown) => void): unknown }
interface Message { rpc: 1; id: string; method?: string; value?: unknown; error?: string }
/** Internal main/worker channel only. Renderer never supplies a method directly. */
export class RpcPeer {
  private disposed = false
  private readonly receiveMessage = (message: unknown) => { void this.receive(message) }
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()
  constructor(private readonly port: RpcPort, private readonly dispatch: (method: string, value: unknown) => Promise<unknown>) {
    port.on("message", this.receiveMessage)
  }
  private async receive(value: unknown) {
    if (this.disposed) return
    const message = value as Message
    if (!message || message.rpc !== 1 || typeof message.id !== "string") return
    if (message.method) {
      try { const result = await this.dispatch(message.method, message.value); if (!this.disposed) this.port.postMessage({ rpc: 1, id: message.id, value: result }) }
      catch (error) { if (!this.disposed) { try { this.port.postMessage({ rpc: 1, id: message.id, error: error instanceof Error ? error.message : "本地操作失败" }) } catch { this.dispose() } } }
    } else {
      const pending = this.pending.get(message.id); this.pending.delete(message.id)
      if (message.error) pending?.reject(new Error(message.error)); else pending?.resolve(message.value)
    }
  }
  call<T>(method: string, value?: unknown): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("本地服务已断开"))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject })
      try { this.port.postMessage({ rpc: 1, id, method, value }) } catch { this.pending.delete(id); reject(new Error("本地服务消息发送失败")) }
    })
  }
  dispose() { this.disposed = true; this.port.removeListener?.("message", this.receiveMessage); for (const item of this.pending.values()) item.reject(new Error("本地服务已断开")); this.pending.clear() }
}
