import { Server as HttpsServer } from "node:https"
import type { Server } from "node:net"
import supertest from "supertest"

/**
 * Make supertest connect to the same address family it just bound to.
 *
 * This fixes a real, rare wrong-answer — a request that never reaches the app
 * under test at all. It is not a retry, it does not serialise anything, and it
 * relaxes no assertion: a genuine 404 from our app still fails exactly as before.
 *
 * THE DEFECT (node_modules/supertest/lib/test.js:60-68)
 *
 *   serverAddress(app, path) {
 *     const addr = app.address();
 *     if (!addr) this._server = app.listen(0);       // :63  binds  [::]  (dual-stack)
 *     const port = app.address().port;               // :67
 *     ...
 *     return protocol + '://127.0.0.1:' + port + path;  // :69  connects 127.0.0.1 (IPv4)
 *   }
 *
 * `listen(0)` with no host binds the IPv6 dual-stack wildcard `[::]`, but the
 * URL is hard-coded to the IPv4 loopback. Node also sets SO_REUSEADDR on every
 * listening socket, and on macOS/BSD that lets a wildcard bind sit on a port
 * another local process already holds with an address-specific bind on
 * 127.0.0.1. `listen(0)` then "succeeds" on an occupied port, and the kernel
 * routes the IPv4 loopback connection to the *most specific* bind — the other
 * process. Our Express app never sees the request; supertest reports whatever
 * that process answered.
 *
 * Measured on this machine (Antigravity.app, an Electron app, held
 * 127.0.0.1:49253):
 *   wildcard bind 0.0.0.0:49253   -> succeeds, coexisting with the foreign bind
 *   loopback bind 127.0.0.1:49253 -> EADDRINUSE (correctly refused)
 *   GET 127.0.0.1:49253 after our wildcard listen
 *     -> 404, content-type: text/plain, body "Not found"
 *
 * That is byte-for-byte the anomaly seen in the reviews.test.ts and
 * variants.test.ts auth-gate cases. Our own catch-all (src/app.ts:127) answers
 * `res.status(404).json({ error: "Not found" })`, i.e. application/json plus
 * X-Powered-By: Express — neither was present, so the response was never ours.
 * It reproduces on an unmodified checkout because it depends only on which
 * local ports happen to be occupied, not on our code.
 *
 * Frequency: macOS hands out ephemeral ports (49152-65535) from a single
 * monotonic global cursor, and each supertest request consumes two (the
 * listener plus the client's source port), so a run walks one parity class of
 * 8192 ports. Both observed squatters sat on odd ports, which is why whole runs
 * of 60,000 requests can be clean while another run hits three in 20,000.
 *
 * THE FIX
 *
 * Derive the host from what the socket actually bound to, instead of assuming
 * IPv4. A dual-stack `[::]` listener is reachable on `[::1]`, and reaching it
 * that way sidesteps any process squatting on the IPv4 loopback. The logic
 * adapts on its own: where IPv6 is unavailable (some CI images) `listen(0)`
 * binds 0.0.0.0 and we keep using 127.0.0.1, exactly as before.
 *
 * Note the host must NOT be forced at bind time instead: `listen(0, host)`
 * routes through Node's asynchronous lookupAndListen, so `address()` is still
 * null when supertest reads `.port` synchronously on the next line (test.js:67)
 * — that throws immediately. The bind has to stay `listen(0)`; only the address
 * we dial is ours to correct.
 */

interface SupertestServerAddress {
  prototype: {
    serverAddress(app: Server, path: string): string
    _server?: Server
  }
}

const Test = (supertest as unknown as { Test: SupertestServerAddress }).Test

Test.prototype.serverAddress = function serverAddress(
  this: { _server?: Server },
  app: Server,
  path: string,
): string {
  if (!app.address()) this._server = app.listen(0)

  const addr = app.address()
  if (addr === null || typeof addr === "string") {
    // Unix domain socket (or an unbound server): nothing to correct, keep the
    // upstream behaviour rather than inventing an address.
    return `http://127.0.0.1${path}`
  }

  // `family` is "IPv6" on Node >= 18; older releases reported the number 6.
  const isIPv6 = addr.family === "IPv6" || (addr.family as unknown as number) === 6
  const host = isIPv6 ? "[::1]" : "127.0.0.1"
  const protocol = app instanceof HttpsServer ? "https" : "http"

  return `${protocol}://${host}:${addr.port}${path}`
}
