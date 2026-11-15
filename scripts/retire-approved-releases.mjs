import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// One-time, explicitly approved scope. Never infer versions from a prefix/range.
export const approvedRetirements = Object.freeze([
  { tag: 'v1.5.0', id: 434901290 },
  { tag: 'v1.6.0', id: 436152804 },
  { tag: 'v1.7.0', id: 436257116 },
  { tag: 'v1.8.0', id: 439296888 },
  { tag: 'v1.8.1', id: 439884742 },
  { tag: 'v1.9.0', id: 441385407 },
  { tag: 'v1.9.1', id: 442431934 },
  { tag: 'v1.10.0', id: 442730508 },
].map(Object.freeze))

function assertContext(env) {
  assert.equal(env.GITHUB_REPOSITORY, 'HideInMatrix/Faber')
  assert.equal(env.GITHUB_REPOSITORY_ID, '1335576308')
  assert.equal(env.GITHUB_REPOSITORY_OWNER, 'HideInMatrix')
  assert.equal(env.GITHUB_ACTOR, env.GITHUB_REPOSITORY_OWNER)
  assert.equal(env.GITHUB_EVENT_NAME, 'push')
  assert.equal(env.GITHUB_REF_TYPE, 'tag')
  assert.equal(env.GITHUB_REF_NAME, 'v1.10.1')
  assert.equal(env.GITHUB_REF, 'refs/tags/v1.10.1')
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/)
  assert(env.GH_TOKEN, 'Missing runner-scoped release token')
}

function githubApi(token) {
  return async (method, endpoint, publicDownloadUrl) => {
    assert(endpoint.startsWith('/repos/HideInMatrix/Faber'))
    const url = `https://api.github.com${endpoint}`
    let response = await fetch(url, {
      method,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2026-03-10' },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    })
    // Deleted assets can return 403 to the runner token. Verify public absence
    // independently; never treat a forbidden response itself as deletion proof.
    if (response.status === 403 && method === 'GET' && /^\/repos\/HideInMatrix\/Faber\/releases\/assets\/\d+$/.test(endpoint)) {
      assert(publicDownloadUrl instanceof URL)
      assert.equal(publicDownloadUrl.origin, 'https://github.com')
      assert(publicDownloadUrl.pathname.startsWith('/HideInMatrix/Faber/releases/download/'))
      response = await fetch(publicDownloadUrl, {
        method: 'HEAD',
        headers: { Accept: 'application/octet-stream' },
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      })
      assert.equal(response.status, 404, 'Deleted attachment must also be absent from its public download URL')
    }
    if (![200, 204, 404].includes(response.status)) {
      // Never print tokens, release bodies, or raw error responses.
      throw new Error(`GitHub ${method} ${endpoint} failed: HTTP ${response.status}`)
    }
    return { status: response.status, data: response.status === 200 ? await response.json() : null }
  }
}

export async function retireApprovedReleases(env = process.env, request) {
  assertContext(env)
  const api = request ?? githubApi(env.GH_TOKEN)
  const prefix = '/repos/HideInMatrix/Faber'
  const repo = await api('GET', prefix)
  assert.equal(repo.status, 200, 'Repository must be readable before treating a 404 as absence')
  assert.equal(repo.data.id, 1335576308)
  assert.equal(repo.data.full_name, 'HideInMatrix/Faber')
  const plans = []
  // Preflight the entire scope before the first irreversible request.
  for (const entry of approvedRetirements) {
    const ref = await api('GET', `${prefix}/git/ref/tags/${entry.tag}`)
    assert.equal(ref.status, 404, `Old tag ${entry.tag} must already be removed by the guarded Git push`)
    const byTag = await api('GET', `${prefix}/releases/tags/${entry.tag}`)
    assert([200, 404].includes(byTag.status))
    if (byTag.status === 200) assert.equal(byTag.data.id, entry.id, `Release for ${entry.tag} has changed`)
    const release = await api('GET', `${prefix}/releases/${entry.id}`)
    assert([200, 404].includes(release.status))
    if (release.status === 404) {
      assert.equal(byTag.status, 404, `Unexpected replacement for ${entry.tag}`)
      plans.push({ ...entry, assets: [], absent: true })
      continue
    }
    assert.equal(release.data.id, entry.id)
    assert.equal(release.data.tag_name, entry.tag)
    assert.equal(release.data.draft, false)
    assert(Array.isArray(release.data.assets))
    const assets = release.data.assets.map(({ id, name }) => {
      assert(Number.isSafeInteger(id) && id > 0)
      assert(typeof name === 'string' && name.length > 0 && !/[\\/]/.test(name))
      const url = new URL(`https://github.com/HideInMatrix/Faber/releases/download/${encodeURIComponent(entry.tag)}/${encodeURIComponent(name)}`)
      return { id, url }
    })
    assert.equal(new Set(assets.map(asset => asset.id)).size, assets.length)
    plans.push({ ...entry, assets, absent: false })
  }
  const retired = []
  for (const plan of plans) {
    if (!plan.absent) {
      const deletion = await api('DELETE', `${prefix}/releases/${plan.id}`)
      assert([204, 404].includes(deletion.status), `Deletion failed for ${plan.tag}`)
    }
    assert.equal((await api('GET', `${prefix}/releases/${plan.id}`)).status, 404)
    assert.equal((await api('GET', `${prefix}/releases/tags/${plan.tag}`)).status, 404)
    for (const { id, url } of plan.assets) assert.equal((await api('GET', `${prefix}/releases/assets/${id}`, url)).status, 404, `Asset ${id} absence could not be verified`)
    retired.push({ tag: plan.tag, assets: plan.assets.length, alreadyAbsent: plan.absent })
    console.log(`Retired approved release ${plan.tag}; verified release and attachment removal`)
  }
  return retired
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await retireApprovedReleases()
