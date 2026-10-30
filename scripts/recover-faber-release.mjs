import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Recover this failed publication only. Its verified installers already exist;
// do not move the tag or rebuild/re-sign application code for a script fix.
export const sourceCommit = '70ea3bfa9bc407594debbd8e1366b4636b2eca5b'
const repository = 'HideInMatrix/micromatrix-workbench'
const targets = {
  'macos-arm64': 'aarch64-apple-darwin',
  'macos-x64': 'x86_64-apple-darwin',
  'windows-x64': 'x86_64-pc-windows-msvc',
}
const allowedRepairs = new Set([
  '.github/workflows/desktop.yml', '.github/workflows/recover-faber-release.yml',
  'scripts/replace-legacy-brand-release.mjs',
  'scripts/recover-faber-release.mjs',
  'scripts/publish-desktop-release.sh',
])
export function validateRepairFiles(files) {
  for (const file of files) assert(allowedRepairs.has(file), `Application/build inputs changed since the original build: ${file}`)
}
export function selectRecoveryRun(runs) {
  const run = runs.find(run => run.head_sha === sourceCommit && run.head_branch === 'v1.0.0'
    && run.event === 'push' && run.status === 'completed' && run.conclusion === 'failure'
    && run.path === '.github/workflows/desktop.yml')
  assert(run && Number.isSafeInteger(run.id) && run.id > 0, 'No matching completed failed tag publication; refusing to reuse another build')
  return run.id
}
export function validateRecoveryJobs(jobs) {
  assert.equal(jobs.filter(job => job.name === 'verify' && job.conclusion === 'success').length, 1, 'Source verification did not pass')
  for (const profile of Object.keys(targets)) {
    const matches = jobs.filter(job => job.name.startsWith('build (') && job.name.includes(profile))
    assert.equal(matches.length, 1, `Missing or ambiguous native job: ${profile}`)
    assert.equal(matches[0].conclusion, 'success', `Native build did not pass: ${profile}`)
  }
  const release = jobs.find(job => job.name === 'release')
  assert.equal(release?.conclusion, 'failure', 'Not a failed release-only job')
  assert(release.steps.some(step => step.name === 'Verify signed update packages and prepare desktop release' && step.conclusion === 'success'), 'Original package verification did not pass')
  assert(release.steps.some(step => step.name === 'Replace only the explicitly superseded legacy-brand release' && step.conclusion === 'failure'), 'Failure is not the expected legacy replacement step')
}
export function validateRecoveryArtifacts(artifacts) {
  for (const profile of Object.keys(targets)) {
    const matches = artifacts.filter(artifact => artifact.name === `micromatrix-${profile}`)
    assert.equal(matches.length, 1, `Missing or ambiguous artifact: ${profile}`)
    assert.equal(matches[0].expired, false, `Expired artifact: ${profile}`)
  }
}
export function validateRecoveryMetadata(metadata, profile, runId) {
  assert.equal(metadata.commit, sourceCommit, `Wrong source commit: ${profile}`)
  assert.equal(metadata.tag, 'v1.0.0')
  assert.equal(metadata.appVersion, '1.0.0')
  assert.equal(metadata.target, targets[profile])
  assert.equal(String(metadata.workflowRun), String(runId), `Wrong source run: ${profile}`)
  assert.equal(metadata.experimental, false, `Not a release build: ${profile}`)
}
export function recoverFaberRelease(env = process.env, run = execFileSync) {
  assert.equal(env.GITHUB_REPOSITORY, repository)
  assert.equal(env.GITHUB_REF, 'refs/heads/master', 'Recovery must use trusted master, not a PR or arbitrary branch')
  const command = args => run('git', args, { encoding: 'utf8' }).trim()
  assert.equal(command(['rev-parse', 'v1.0.0^{}']), sourceCommit, 'The version tag moved; original artifacts no longer match')
  validateRepairFiles(command(['diff', '--name-only', sourceCommit, 'HEAD']).split('\n').filter(Boolean))
  if (env.RECOVERY_RUN_ID) {
    assert(/^\d+$/.test(env.RECOVERY_RUN_ID))
    for (const profile of Object.keys(targets)) {
      validateRecoveryMetadata(JSON.parse(readFileSync(path.resolve(`build-artifacts/build-${profile}.json`), 'utf8')), profile, env.RECOVERY_RUN_ID)
    }
    return env.RECOVERY_RUN_ID
  }
  const api = (endpoint, filter) => JSON.parse(run('gh', ['api', `repos/${repository}/${endpoint}`, '--jq', filter], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024,
  }))
  const runs = api(`actions/workflows/desktop.yml/runs?head_sha=${sourceCommit}&per_page=30`,
    '.workflow_runs | map({id, head_sha, head_branch, event, status, conclusion, path})')
  const id = selectRecoveryRun(runs)
  validateRecoveryJobs(api(`actions/runs/${id}/jobs?per_page=100`, '.jobs | map({name, conclusion, steps: [.steps[] | {name, conclusion}]})'))
  validateRecoveryArtifacts(api(`actions/runs/${id}/artifacts?per_page=100`, '.artifacts | map({name, expired})'))
  assert(env.GITHUB_OUTPUT, 'Missing GitHub step output file')
  appendFileSync(env.GITHUB_OUTPUT, `run_id=${id}\n`)
  console.log(`Verified source/build jobs and retained artifacts: https://github.com/${repository}/actions/runs/${id}`)
  return id
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) recoverFaberRelease()
