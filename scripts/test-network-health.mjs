import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { getEventListeners } from 'node:events'

const bundled = await build({ entryPoints: [fileURLToPath(new URL('../packages/network/src/health.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm' })
const { NetworkHealthMonitor, probePublicService, PublicRouteError, waitForPublicService } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function bounded(promise, timeoutMs = 250) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Operation did not settle after cancellation')), timeoutMs)
    })])
  } finally { clearTimeout(timer) }
}

test('Stop drains the monitor even when a suspended network probe ignores abort', async () => {
  const entered = deferred(), pending = deferred(), results = []
  let signal
  const monitor = new NetworkHealthMonitor(s => {
    signal = s; entered.resolve(); return pending.promise
  }, error => results.push(error), 1, { onProbeResult: result => results.push(result) })
  monitor.start()
  await bounded(entered.promise)
  try {
    await bounded(monitor.stop())
    assert.equal(signal.aborted, true)
    assert.equal(getEventListeners(signal, 'abort').length, 0)
    await bounded(monitor.stop())
    pending.reject(new Error('DNS failed after wake-up'))
    await delay(10)
    assert.deepEqual(results, [], 'Late probe rejection must not change stopped Runtime state')
  } finally { pending.resolve(); await monitor.stop() }
})

test('Stop cancels the interval without ever starting a new probe', async () => {
  let probes = 0
  const monitor = new NetworkHealthMonitor(async () => { probes++ }, () => assert.fail(), 60_000)
  monitor.start()
  await bounded(monitor.stop())
  await bounded(monitor.stop())
  assert.equal(probes, 0)
})

test('A late successful probe cannot report recovery or schedule another probe after Stop', async () => {
  const entered = deferred(), pending = deferred(), results = []
  let probes = 0
  const monitor = new NetworkHealthMonitor(() => {
    probes++; entered.resolve(); return pending.promise
  }, () => assert.fail(), 1, { onProbeResult: result => results.push(result) })
  monitor.start()
  await bounded(entered.promise)
  try {
    await bounded(monitor.stop())
    pending.resolve()
    await delay(10)
    assert.equal(probes, 1)
    assert.deepEqual(results, [])
  } finally { pending.resolve(); await monitor.stop() }
})

test('Public probe cancellation does not depend on fetch observing its signal', async t => {
  const entered = deferred(), pending = deferred(), controller = new AbortController()
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original; pending.resolve(new Response()) })
  let requestSignal
  globalThis.fetch = (_url, options) => {
    requestSignal = options.signal; entered.resolve(); return pending.promise
  }
  const probe = probePublicService('https://health.invalid', 'owned', controller.signal)
  await bounded(entered.promise)
  const reason = new Error('Runtime stopped')
  controller.abort(reason)
  await assert.rejects(bounded(probe), error => error === reason)
  assert.equal(requestSignal.aborted, true)
  let bodyCancelled = false
  pending.resolve(new Response(new ReadableStream({ cancel() { bodyCancelled = true } })))
  await delay(0)
  assert.equal(bodyCancelled, true, 'A late fetch response must have its unread body cancelled')
})

test('Startup public-route wait can be interrupted while fetch is stuck', async t => {
  const entered = deferred(), pending = deferred(), controller = new AbortController()
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original; pending.resolve(new Response()) })
  globalThis.fetch = () => { entered.resolve(); return pending.promise }
  const wait = waitForPublicService('https://health.invalid', 'owned', controller.signal)
  await bounded(entered.promise)
  const reason = new Error('Startup cancelled')
  controller.abort(reason)
  await assert.rejects(bounded(wait), error => error === reason)
})

test('Stop interrupts reading a response whose body has stalled', async t => {
  const reading = deferred(), controller = new AbortController()
  let cancelled = false
  const body = new ReadableStream({
    pull() { reading.resolve(); return new Promise(() => {}) },
    cancel() { cancelled = true; return new Promise(() => {}) },
  })
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => new Response(body, { headers: { 'content-type': 'application/json' } })
  const probe = probePublicService('https://health.invalid', 'owned', controller.signal)
  await bounded(reading.promise)
  controller.abort(new Error('Runtime stopped'))
  await assert.rejects(bounded(probe), /Runtime stopped/)
  assert.equal(cancelled, true, 'Stop must cancel the owned body reader as well as settling the waiter')
  assert.equal(body.locked, false)
})

test('Ten-second probe deadline is effective even when fetch ignores abort', async t => {
  const pending = deferred(), original = globalThis.fetch
  t.after(() => { globalThis.fetch = original; pending.resolve(new Response()) })
  globalThis.fetch = () => pending.promise
  await assert.rejects(bounded(probePublicService('https://health.invalid', 'owned'), 11500),
    error => error instanceof PublicRouteError && error.code === 'timeout' && error.message.includes('10 seconds'))
})

test('A healthy public route responding after four seconds still passes', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => {
    await delay(4000)
    return Response.json({ ok: true, instance_id: 'owned' })
  }
  await bounded(probePublicService('https://health.invalid', 'owned'), 5500)
})

test('Bad HTTP response does not wait for a stalled body cancellation', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { return new Promise(() => {}) } }), { status: 503 })
  await assert.rejects(bounded(probePublicService('https://health.invalid', 'owned')),
    error => error instanceof PublicRouteError && error.code === 'http_error')
})

test('Oversized response cancels its reader without waiting for cancel to settle', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let cancelled = false
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(16385)) },
    cancel() { cancelled = true; return new Promise(() => {}) },
  })
  globalThis.fetch = async () => new Response(body, { headers: { 'content-type': 'application/json' } })
  await assert.rejects(bounded(probePublicService('https://health.invalid', 'owned')),
    error => error instanceof PublicRouteError && error.code === 'response_too_large')
  assert.equal(cancelled, true)
  assert.equal(body.locked, false)
})

test('Normal probe still validates the service instance and rejects foreign health responses', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async () => Response.json({ ok: true, instance_id: 'owned' })
  await probePublicService('https://health.invalid', 'owned')
  await assert.rejects(probePublicService('https://health.invalid', 'foreign'),
    error => error instanceof PublicRouteError && error.code === 'instance_mismatch')
})

test('Cancelled probe does not even call fetch', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  let requests = 0
  globalThis.fetch = async () => { requests++; return Response.json({ ok: true, instance_id: 'owned' }) }
  const controller = new AbortController(), reason = new Error('Already stopped')
  controller.abort(reason)
  await assert.rejects(probePublicService('https://health.invalid', 'owned', controller.signal), error => error === reason)
  assert.equal(requests, 0)
})

test('Running monitor still serializes probes and recovers after three failures', async () => {
  const recovered = deferred(), results = [], failures = []
  let calls = 0, active = 0, maxActive = 0
  const monitor = new NetworkHealthMonitor(async () => {
    active++; maxActive = Math.max(maxActive, active)
    try {
      await delay(2)
      if (++calls <= 3) throw new Error('Route temporarily unavailable')
    } finally { active-- }
  }, error => failures.push(error), 1, {
    keepRunningOnFailure: true,
    onProbeResult(result) { results.push(result.failures); if (result.ok) recovered.resolve() },
  })
  monitor.start()
  try {
    await bounded(recovered.promise)
    await bounded(monitor.stop())
    assert.deepEqual(results, [1, 2, 3, 0])
    assert.equal(maxActive, 1)
    assert.equal(failures.length, 1)
  } finally { await monitor.stop() }
})
