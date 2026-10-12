import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { verifyReleaseSource } from './verify-release-source.mjs'

const env = {
  GITHUB_REPOSITORY: 'HideInMatrix/Faber', GITHUB_REPOSITORY_OWNER: 'HideInMatrix',
  GITHUB_REPOSITORY_ID: '1335576308',
  GITHUB_ACTOR: 'HideInMatrix', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'tag',
  GITHUB_REF_NAME: 'v1.0.1', GITHUB_REF: 'refs/tags/v1.0.1', GITHUB_SHA: 'a'.repeat(40),
}
const source = readFileSync(new URL('../.github/workflows/desktop.yml', import.meta.url), 'utf8')
function workflowAllows(job, overrides = {}) {
  const block = source.split(`  ${job}:\n`)[1].split(/\n  [a-z_]+:\n/)[0]
  const expression = /^    if: (.+)$/m.exec(block)[1]
  const github = { repository: env.GITHUB_REPOSITORY, repository_id: env.GITHUB_REPOSITORY_ID, repository_owner: env.GITHUB_REPOSITORY_OWNER,
    actor: env.GITHUB_ACTOR, event_name: 'push', ref_type: 'tag', ref: env.GITHUB_REF,
    event: { repository: { private: false } }, ...overrides }
  return Function('github', 'startsWith', `return Boolean(${expression})`)(github, (value, prefix) => value.startsWith(prefix))
}

test('Only exact owner-pushed SemVer release source from master passes the pre-secret gate', () => {
  const calls = []
  verifyReleaseSource(env, (program, args, options) => {
    assert.equal(program, 'git'); assert.equal(options.timeout, 30_000); assert.equal(options.maxBuffer, 64 * 1024)
    calls.push(args)
    return args[0] === 'rev-parse' ? env.GITHUB_SHA : ''
  })
  assert.deepEqual(calls, [['rev-parse', 'HEAD'], ['rev-parse', 'refs/tags/v1.0.1^{}'],
    ['merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/master']])
})

test('Fork, non-owner, PR, branch/manual events and invalid tags fail before invoking Git', () => {
  for (const update of [
    { GITHUB_REPOSITORY: 'Other/micromatrix-workbench' }, { GITHUB_REPOSITORY_OWNER: 'Other' },
    { GITHUB_REPOSITORY: 'HideInMatrix/micromatrix-workbench' }, { GITHUB_REPOSITORY_ID: '1' },
    { GITHUB_ACTOR: 'Other' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { GITHUB_REF_TYPE: 'branch' }, { GITHUB_REF_NAME: 'vbad' }, { GITHUB_REF: 'refs/heads/master' },
    { GITHUB_SHA: 'invalid' },
  ]) assert.throws(() => verifyReleaseSource({ ...env, ...update }, () => assert.fail('Git must not run')))
})

test('Mismatched checkout, moved tag and tag outside master fail closed', () => {
  assert.throws(() => verifyReleaseSource(env, () => 'b'.repeat(40)), /Checkout/)
  assert.throws(() => verifyReleaseSource(env, (_, args) => args[1] === 'HEAD' ? env.GITHUB_SHA : 'b'.repeat(40)), /tag/)
  assert.throws(() => verifyReleaseSource(env, (_, args) => {
    if (args[0] === 'merge-base') throw new Error('not an ancestor')
    return env.GITHUB_SHA
  }), /ancestor/)
})

test('All secret-bearing desktop jobs allow the approved public owner tag and deny untrusted contexts', () => {
  for (const job of ['verify', 'build', 'release']) {
    assert.equal(workflowAllows(job), true, job)
    for (const update of [
      { repository: 'Other/micromatrix-workbench', repository_owner: 'Other', actor: 'Other' },
      { repository: 'HideInMatrix/micromatrix-workbench' }, { repository_id: '1' },
      { actor: 'Other' }, { event_name: 'pull_request' }, { event_name: 'pull_request_target' },
      { event_name: 'workflow_dispatch' }, { ref_type: 'branch', ref: 'refs/heads/master' },
      { ref: 'refs/tags/not-a-version' },
    ]) assert.equal(workflowAllows(job, update), false, `${job}: ${JSON.stringify(update)}`)
  }
})

test('Legacy private master checks/manual builds remain available, never manual release publication', () => {
  const privateMaster = { event: { repository: { private: true } }, ref_type: 'branch', ref: 'refs/heads/master' }
  assert.equal(workflowAllows('verify', privateMaster), true)
  assert.equal(workflowAllows('build', { ...privateMaster, event_name: 'workflow_dispatch' }), true)
  assert.equal(workflowAllows('release', { ...privateMaster, event_name: 'workflow_dispatch' }), false)
})

test('Source gate precedes secrets; full history, no checkout credentials and no npm cache stay enforced', () => {
  assert(source.indexOf('node scripts/verify-release-source.mjs') < source.indexOf('TAURI_SIGNING_PRIVATE_KEY:'))
  assert.match(source, /fetch-depth: 0/)
  assert.equal((source.match(/persist-credentials: false/g) ?? []).length, 3)
  assert.equal((source.match(/package-manager-cache: false/g) ?? []).length, 2)
  assert.match(source, /needs: \[verify, build\]/)
  assert.match(source, /node scripts\/prepare-release-assets\.mjs/)
  assert.doesNotMatch(source, /pull_request_target:/)
})
