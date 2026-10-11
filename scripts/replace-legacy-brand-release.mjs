import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// One explicitly requested brand migration, not a general mutable-release mode.
// Run only after all replacement installers and signatures have been verified.
export function canReplaceLegacyBrandRelease(tag, productName, release) {
  return tag === 'v1.0.0' && productName === 'Faber'
    && release.tagName === tag && release.name === 'micromatrix agent v1.0.0'
    && release.isDraft === false
}

export function replaceLegacyBrandRelease(env = process.env, run = execFileSync) {
  const tag = env.RELEASE_TAG
  const product = JSON.parse(readFileSync(new URL('../apps/desktop/tauri.conf.json', import.meta.url), 'utf8')).productName
  if (tag !== 'v1.0.0' || product !== 'Faber') return false
  const repository = env.GITHUB_REPOSITORY
  if (repository !== 'HideInMatrix/micromatrix-workbench') throw new Error('Brand replacement is restricted to the original repository')
  // Distinguish a missing release from an authentication/network failure.
  // Fail closed for other errors; never infer "not found" from any failed call.
  const releases = JSON.parse(run('gh', ['api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`], { encoding: 'utf8' })).flat()
  const found = releases.find(release => release.tag_name === tag)
  if (!found) return false
  if (!canReplaceLegacyBrandRelease(tag, product, { tagName: found.tag_name, name: found.name, isDraft: found.draft })) return false
  run('gh', ['release', 'delete', tag, '--repo', repository, '--yes'], { stdio: 'inherit' })
  console.log('Removed the explicitly superseded legacy-brand v1.0.0 release and assets; retained the replacement Git tag')
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) replaceLegacyBrandRelease()
