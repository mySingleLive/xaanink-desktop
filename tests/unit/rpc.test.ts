import assert from "node:assert/strict"
import { test } from "node:test"
import { EventEmitter } from "node:events"
import { RpcPeer } from "../../desktop/service/rpc"
class Port extends EventEmitter { posts: unknown[] = []; broken = false; postMessage(value: unknown) { if (this.broken) throw new Error("send failed"); this.posts.push(value) } }
test("IPC-01: a dead worker rejects pending and future calls without posting or hanging", async () => {
  const port = new Port(); const peer = new RpcPeer(port, async () => true)
  const pending = peer.call("pending"); peer.dispose()
  await assert.rejects(pending, /断开/)
  const future = peer.call("future"); const result = await Promise.race([future.then(() => "resolved", () => "rejected"), new Promise(resolve => setTimeout(() => resolve("pending"), 20))])
  assert.equal(result, "rejected"); assert.equal(port.posts.length, 1)
  assert.equal(port.listenerCount("message"), 0)
})
test("IPC-01: serialization/send failures settle the request and do not retain waiters", async () => {
  const port = new Port(); port.broken = true; const peer = new RpcPeer(port, async () => true)
  await assert.rejects(peer.call("broken"), /发送失败/)
  assert.equal((peer as unknown as { pending: Map<string, unknown> }).pending.size, 0)
  peer.dispose()
})
