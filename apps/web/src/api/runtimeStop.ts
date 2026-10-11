/** A timed-out Stop response is not a failed Stop transaction. Reconcile only
 * through read-only status; never send another Stop or fabricate completion. */
export async function confirmRuntimeStopped<T extends { running: boolean; stopping?: boolean }>(options: {
  read: (signal: AbortSignal) => Promise<T>
  onSnapshot: (snapshot: T) => void
  isCurrent: () => boolean
  delay: (ms: number) => Promise<void>
  now?: () => number
  timeoutMs?: number
}): Promise<T | undefined> {
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? 15_000
  const deadline = now() + timeoutMs
  const signal = AbortSignal.timeout(timeoutMs)
  let latest: T | undefined
  while (options.isCurrent() && now() < deadline && !signal.aborted) {
    try {
      const snapshot = await options.read(signal)
      if (!options.isCurrent()) return undefined
      latest = snapshot
      options.onSnapshot(snapshot)
      if (!snapshot.running && snapshot.stopping !== true) return snapshot
    } catch { /* Lost status is not evidence of successful cleanup. */ }
    if (!options.isCurrent() || signal.aborted) break
    const remaining = deadline - now()
    if (remaining > 0) await options.delay(Math.min(500, remaining))
  }
  return latest
}
