import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { releaseDownloadRepository } from './release-download-repository.mjs'

test('Renamed release retains the original download alias for installed clients', () => {
  assert.equal(releaseDownloadRepository('HideInMatrix/Faber'), 'HideInMatrix/micromatrix-workbench')
  assert.equal(releaseDownloadRepository('HideInMatrix/micromatrix-workbench'), 'HideInMatrix/micromatrix-workbench')
  assert.equal(releaseDownloadRepository('Other/project'), 'Other/project')
  for (const value of ['https://github.com/HideInMatrix/Faber', '../Faber', 'owner/repo?token=x', 'owner/repo/extra']) {
    assert.throws(() => releaseDownloadRepository(value))
  }
  const source = readFileSync(new URL('./prepare-release-assets.mjs', import.meta.url), 'utf8')
  assert.match(source, /releaseDownloadRepository\(repository\)/)
  assert.match(source, /github\.com\/\$\{downloadRepository\}\/releases\/download/)
})

test('New app uses the canonical manifest and accepts only the canonical or legacy release path', () => {
  const config = JSON.parse(readFileSync(new URL('../apps/desktop/tauri.conf.json', import.meta.url), 'utf8'))
  const manifest = 'https://github.com/HideInMatrix/Faber/releases/latest/download/latest.json'
  assert.deepEqual(config.plugins.updater.endpoints, [manifest])
  const source = readFileSync(new URL('../apps/desktop/src/update_preferences.rs', import.meta.url), 'utf8')
  assert(source.includes(`const MANIFEST: &str = "${manifest}"`))
  const prefixes = [...source.matchAll(/original\.path\(\)\.starts_with\("([^"]+)"\)/g)].map(match => match[1])
  assert.deepEqual(prefixes, ['/HideInMatrix/Faber/releases/', '/HideInMatrix/micromatrix-workbench/releases/'])
  for (const candidate of ['/Other/Faber/releases/download/x', '/HideInMatrix/Faber-other/releases/x', '/HideInMatrix/Faber/releases-evil/x']) {
    assert(!prefixes.some(prefix => candidate.startsWith(prefix)))
  }
  assert.match(source, /original\.host_str\(\) != Some\("github\.com"\)/)
  assert.match(source, /original\.scheme\(\) != "https"/)
})
