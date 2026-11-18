import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const localPackage = 'third_party/picomatch'
const installedPackage = 'node_modules/picomatch'
const advisoryUrl = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf'
const guardedParserSha256 = '5b556751b229a71fab125b81b979fb8f4818a46430c8fd29a362fd334ebf5e37'
const severities = ['info', 'low', 'moderate', 'high', 'critical']
const blocking = severity => severity === 'high' || severity === 'critical'

function verifyPicomatchMitigation(finding) {
  const { packages } = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'))
  const copies = Object.entries(packages).filter(([location, pkg]) =>
    location === installedPackage || location.endsWith('/node_modules/picomatch') || pkg.name === 'picomatch')
  const isLocalCopy = location => location === installedPackage || location === localPackage
  assert(copies.every(([location]) => isLocalCopy(location)), 'Unexpected picomatch copy in lockfile')
  assert.equal(packages[installedPackage]?.resolved, localPackage)
  assert.equal(packages[installedPackage]?.link, true)
  assert.equal(packages[localPackage]?.version, '4.0.7')
  assert(Array.isArray(finding.nodes) && finding.nodes.length > 0, 'Missing audited picomatch locations')
  assert(finding.nodes.every(isLocalCopy), 'Unpatched picomatch location in audit report')

  const require = createRequire(new URL('package.json', root))
  const parser = require.resolve('picomatch/lib/parse.js')
  assert.equal(realpathSync(parser), realpathSync(new URL(`${localPackage}/lib/parse.js`, root)))
  const source = readFileSync(parser, 'utf8').replaceAll('\r\n', '\n')
  assert.equal(createHash('sha256').update(source).digest('hex'), guardedParserSha256, 'The reviewed picomatch parser has changed')

  const blocked = { name: 'SyntaxError', message: 'Quantified extglobs are disabled in the Faber build' }
  for (const entry of ['picomatch', 'picomatch/posix']) {
    const match = require(entry)
    assert(match('src/**/*.{ts,vue}')('src/components/List.vue'))
    assert(match('src/@(main|index).ts')('src/main.ts'))
    assert(!match('src/**/*.ts')('src/List.vue'))
    assert.throws(() => match.makeRe('+(sample)'), blocked)
    assert.throws(() => match.parse('*(sample)', { maxExtglobRecursion: false }), blocked)
  }
}

function readAuditReport() {
  const npm = process.env.npm_execpath
  assert(npm, 'Run the release audit with npm run audit:release')
  const result = spawnSync(process.execPath, [npm, 'audit', '--audit-level=high', '--include=dev', '--include=optional', '--include=peer', '--registry=https://registry.npmjs.org', '--json'],
    { cwd: fileURLToPath(root), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.error) throw result.error
  assert([0, 1].includes(result.status), `npm audit failed to run (exit ${result.status})`)
  const report = JSON.parse(result.stdout)
  assert(report.auditReportVersion === 2 && !report.error, 'npm audit did not return a vulnerability report')

  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    assert(severities.includes(finding.severity), `Unrecognized audit severity: ${name}`)
    assert(Array.isArray(finding.via) && finding.via.length > 0, `Missing audit causes: ${name}`)
    counts[finding.severity]++
  }
  for (const severity of severities) assert.equal(report.metadata.vulnerabilities[severity], counts[severity])
  assert.equal(result.status === 1, counts.high + counts.critical > 0, 'npm audit exit status does not match findings')
  return report.vulnerabilities
}

const vulnerabilities = readAuditReport()
const outcomes = new Map()
let mitigationVerified = false

function auditOutcome(name) {
  if (outcomes.has(name)) return outcomes.get(name)
  assert(Object.hasOwn(vulnerabilities, name), `Unknown audit cause: ${name}`)
  const finding = vulnerabilities[name]
  // Fail closed if npm returns a cycle instead of establishing all causes.
  outcomes.set(name, 'blocked')
  const causes = finding.via.map(cause => {
    if (typeof cause === 'string') return auditOutcome(cause)
    assert(severities.includes(cause.severity), `Unrecognized advisory severity: ${name}`)
    if (name === 'picomatch' && cause.name === 'picomatch' && cause.severity === 'high'
      && cause.range === '<=4.0.7' && cause.url === advisoryUrl) {
      if (!mitigationVerified) verifyPicomatchMitigation(finding)
      mitigationVerified = true
      return 'mitigated'
    }
    return blocking(cause.severity) ? 'blocked' : 'nonblocking'
  })
  const hasMitigatedCause = causes.includes('mitigated')
  let outcome = hasMitigatedCause ? 'mitigated' : 'nonblocking'
  if (causes.includes('blocked') || finding.severity === 'critical' || (finding.severity === 'high' && !hasMitigatedCause)) {
    outcome = 'blocked'
  }
  outcomes.set(name, outcome)
  return outcome
}

const blockers = []
for (const [name, finding] of Object.entries(vulnerabilities)) {
  const outcome = auditOutcome(name)
  if (outcome === 'blocked') blockers.push(name)
  if (outcome !== 'mitigated') {
    const causes = finding.via.map(cause => typeof cause === 'string' ? cause : cause.url).join(', ')
    console.log(`${finding.severity}: ${name} (${causes})`)
  }
}
if (mitigationVerified) console.log(`Verified the local picomatch mitigation for ${advisoryUrl}`)
assert.equal(blockers.length, 0, 'Unmitigated high or critical npm vulnerabilities')
console.log('PASS release audit: no unmitigated high or critical findings')
