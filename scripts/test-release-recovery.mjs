import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  sourceCommit, selectRecoveryRun, validateRecoveryJobs, validateRepairFiles,
  validateRecoveryArtifacts, validateRecoveryMetadata, recoverFaberRelease,
} from './recover-faber-release.mjs'

const profiles = {
  'macos-arm64': 'aarch64-apple-darwin',
  'macos-x64': 'x86_64-apple-darwin',
  'windows-x64': 'x86_64-pc-windows-msvc',
}
test('select only the original completed failed tag workflow, never another source/branch', () => {
  const run = { id: 123, head_sha: sourceCommit, head_branch: 'v1.0.0', event: 'push', status: 'completed', conclusion: 'failure', path: '.github/workflows/desktop.yml' }
  assert.equal(selectRecoveryRun([run]), 123)
  for (const changes of [{head_sha: 'other'}, {head_branch:'master'}, {event:'pull_request'}, {status:'in_progress'}, {conclusion:'success'}, {path:'.github/workflows/ci.yml'}, {id:-1}]) {
    assert.throws(() => selectRecoveryRun([{...run, ...changes}]))
  }
})
test('all three native jobs and prior signature verification must have passed', () => {
  const jobs = [
    { name: 'verify', conclusion: 'success' },
    ...Object.keys(profiles).map(profile => ({ name: `build (runner, ${profile}, target, bundles)`, conclusion: 'success' })),
    { name: 'release', conclusion: 'failure', steps: [
      {name:'Verify signed update packages and prepare desktop release',conclusion:'success'},
      {name:'Replace only the explicitly superseded legacy-brand release',conclusion:'failure'},
    ] },
  ]
  validateRecoveryJobs(jobs)
  assert.throws(() => validateRecoveryJobs(jobs.slice(1)))
  for (let i = 1; i <= 3; i++) assert.throws(() => validateRecoveryJobs(jobs.map((job,j) => j === i ? {...job, conclusion:'failure'} : job)))
  assert.throws(() => validateRecoveryJobs([...jobs, jobs[1]]))
  assert.throws(() => validateRecoveryJobs(jobs.map(job => job.name === 'release' ? {...job, steps:[]} : job)))
})
test('recovery rejects runtime, build, dependency and signing policy edits', () => {
  validateRepairFiles(['scripts/replace-legacy-brand-release.mjs', '.github/workflows/recover-faber-release.yml'])
  for (const file of ['apps/daemon/src/runtime.ts', 'package-lock.json', 'apps/desktop/tauri.conf.json', 'scripts/verify-updater-signature.mjs', 'scripts/build-sidecar.mjs']) {
    assert.throws(() => validateRepairFiles([file]))
  }
})
test('expired, missing or ambiguous artifacts cannot be recovered', () => {
  const artifacts = Object.keys(profiles).map(profile => ({ name:`micromatrix-${profile}`, expired:false }))
  validateRecoveryArtifacts(artifacts)
  assert.throws(() => validateRecoveryArtifacts(artifacts.slice(1)))
  assert.throws(() => validateRecoveryArtifacts([...artifacts, artifacts[0]]))
  assert.throws(() => validateRecoveryArtifacts(artifacts.map(item => ({...item, expired:true}))))
})
test('metadata binds every installer to the original source, run, platform and release', () => {
  for (const [profile, target] of Object.entries(profiles)) {
    const metadata = {commit:sourceCommit, tag:'v1.0.0', appVersion:'1.0.0', target, workflowRun:'123', experimental:false}
    validateRecoveryMetadata(metadata, profile, '123')
    for (const changes of [{commit:'other'}, {tag:'v1.0.1'}, {appVersion:'1.0.1'}, {target:'other'}, {workflowRun:'124'}, {experimental:true}]) {
      assert.throws(() => validateRecoveryMetadata({...metadata,...changes},profile,'123'))
    }
  }
})

test('recovery entry point performs only bounded filtered API reads before exposing a run ID', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'faber-recovery-'))
  try {
    const output = path.join(temporary, 'output')
    const env = {GITHUB_REPOSITORY:'HideInMatrix/micromatrix-workbench',GITHUB_REF:'refs/heads/master',GITHUB_OUTPUT:output}
    const execute = (file, args, options) => {
      if (file === 'git') return args[0] === 'rev-parse' ? sourceCommit : 'scripts/replace-legacy-brand-release.mjs\n'
      assert.equal(file,'gh')
      assert.equal(args[0],'api')
      assert.equal(args[2],'--jq')
      assert.equal(options.maxBuffer,64*1024)
      assert.equal(options.timeout,30_000)
      if (args[1].includes('/workflows/')) return JSON.stringify([{id:123,head_sha:sourceCommit,head_branch:'v1.0.0',event:'push',status:'completed',conclusion:'failure',path:'.github/workflows/desktop.yml'}])
      if (args[1].includes('/jobs?')) return JSON.stringify([
        {name:'verify',conclusion:'success'},
        ...Object.keys(profiles).map(profile=>({name:`build (runner, ${profile}, target)`,conclusion:'success'})),
        {name:'release',conclusion:'failure',steps:[
          {name:'Verify signed update packages and prepare desktop release',conclusion:'success'},
          {name:'Replace only the explicitly superseded legacy-brand release',conclusion:'failure'},
        ]},
      ])
      assert.match(args[1],/\/actions\/runs\/123\/artifacts\?/)
      return JSON.stringify(Object.keys(profiles).map(profile=>({name:`micromatrix-${profile}`,expired:false})))
    }
    assert.equal(recoverFaberRelease(env,execute),123)
    assert.equal(readFileSync(output,'utf8'),'run_id=123\n')
    assert.throws(()=>recoverFaberRelease({...env,GITHUB_REF:'refs/pull/1/merge'},execute))
  } finally {rmSync(temporary,{recursive:true,force:true})}
})
