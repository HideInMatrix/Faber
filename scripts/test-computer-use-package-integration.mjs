import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { computerUseNativeResource, computerUseTargets } from './computer-use-package.mjs'
import { assertDistributionTree } from './distribution-privacy.mjs'

// Host/package contract smoke test. No screenshots, native input, browser
// launch, permission prompts, or user's Runtime start/stop/configuration.
for (const target of computerUseTargets) computerUseNativeResource(target)
const automation = path.resolve('apps/desktop/resources/automation/playwright-core')
assertDistributionTree(automation)
const playwright = createRequire(path.join(automation, 'package.json'))('./index.js')
assert(playwright.chromium && playwright.firefox && playwright.webkit)
const fixture = await mkdtemp(path.join(tmpdir(), 'mm-private-cu-host-'))
const client = new Client({ name: 'private-package-host-smoke', version: '1.0.0' })
const transport = new StdioClientTransport({ command: process.execPath,
  args: [path.resolve('dist/micromatrix-service.cjs'), '--computer-use-mcp', '--workspace', fixture], stderr: 'pipe' })
try {
  await writeFile(path.join(fixture, 'sample.json'), '{"count":1}')
  await client.connect(transport)
  const tools = (await client.listTools()).tools
  assert.equal(tools.length, 9)
  assert(tools.some(tool => tool.name === 'computer_run'))
  const capabilities = await client.callTool({name:'computer_capabilities',arguments:{}})
  assert(!capabilities.isError)
  const c = JSON.parse(capabilities.content[0].text)
  assert.equal(c.contract.component_version, '0.1.3')
  assert.equal(c.contract.native_protocol, 3)
  assert.equal(c.contract.tool_count, 9)
  assert.equal(c.actions_enabled, false)
  assert(c.adapters.some(adapter => adapter.id === 'desktop-visual'))
  assert(c.adapters.some(adapter => adapter.id === 'remote-desktop'))
  const observed = await client.callTool({name:'computer_observe',arguments:{adapter:'json',target:'sample.json'}})
  assert(!observed.isError)
  assert(JSON.parse(observed.content[0].text).interactive_elements.some(item => item.id === 'json:/count' && item.value === 1))
  const batch = await client.callTool({name:'computer_run',arguments:{code:'const c = await computer.capabilities(); return {enabled:c.actions_enabled};'}})
  assert(batch.isError)
  assert.equal(JSON.parse(batch.content[0].text).error, 'READ_ONLY')
  // Enable only this isolated test host to verify the WASM batch runtime.
  // The batch contains capabilities() only, never a desktop/input action.
  const batchClient = new Client({ name: 'private-package-batch-smoke', version: '1.0.0' })
  try {
    await batchClient.connect(new StdioClientTransport({ command: process.execPath,
      args: [path.resolve('dist/micromatrix-service.cjs'), '--computer-use-mcp', '--workspace', fixture, '--allow-actions'], stderr: 'pipe' }))
    const result = await batchClient.callTool({name:'computer_run',arguments:{code:'const c = await computer.capabilities(); return {enabled:c.actions_enabled};'}})
    assert(!result.isError, JSON.stringify(result))
    assert.equal(JSON.parse(result.content[0].text).result.enabled, true)
  } finally { await batchClient.close() }
  console.log('PASS private package host MCP: 9 tools, ABI 3, JSON observe, bundled QuickJS and map-free Playwright load; no desktop actions')
} finally {
  await client.close()
  await rm(fixture, {recursive:true,force:true})
}
