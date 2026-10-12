import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { versionFromTag } from './release-version.mjs'

// The public repository may build only an owner-pushed SemVer tag whose exact
// source is reachable from master. Run before any signing/package secret use.
export function verifyReleaseSource(env = process.env, run = execFileSync) {
  assert.equal(env.GITHUB_REPOSITORY, 'HideInMatrix/micromatrix-workbench')
  assert.equal(env.GITHUB_REPOSITORY_OWNER, 'HideInMatrix')
  assert.equal(env.GITHUB_ACTOR, env.GITHUB_REPOSITORY_OWNER, 'Release push must come from the repository owner')
  assert.equal(env.GITHUB_EVENT_NAME, 'push')
  assert.equal(env.GITHUB_REF_TYPE, 'tag')
  versionFromTag(env.GITHUB_REF_NAME)
  assert.equal(env.GITHUB_REF, `refs/tags/${env.GITHUB_REF_NAME}`)
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/)
  const command = args => run('git', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 }).trim()
  assert.equal(command(['rev-parse', 'HEAD']), env.GITHUB_SHA, 'Checkout does not match the release push')
  assert.equal(command(['rev-parse', `${env.GITHUB_REF}^{}`]), env.GITHUB_SHA, 'Release tag does not match the checkout')
  command(['merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/master'])
  console.log(`Verified owner-pushed ${env.GITHUB_REF_NAME} from master; package/signing secrets remain runner-only`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) verifyReleaseSource()
