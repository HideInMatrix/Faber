<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Trash2 } from '@lucide/vue'
import { FormField, FormGrid } from '@/components/ui/form'
import { InputGroup, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { desktopApi } from '../../api/desktop'
import { t } from '../../composables/useLocale'
import type { PiMcpConnectionDto } from '../../types'

const props = defineProps<{ connection: PiMcpConnectionDto | null; connections: PiMcpConnectionDto[]; locked: boolean }>()
const emit = defineEmits<{ saved: []; cancel: [] }>()
const initial = props.connection
const draft = ref<PiMcpConnectionDto>(initial ? JSON.parse(JSON.stringify(initial)) as PiMcpConnectionDto : {
  id: `mcp_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`, name: '', enabled: true,
  transport: 'http', auth: 'none', command: '', args: [], url: '', envRefs: {}, headers: {}, oauthTokenAuthMethod: 'auto',
})
const busy = ref(false), loading = ref(false), loadError = ref(''), error = ref('')
const values = ref<Record<string,string|null>>(Object.create(null))
const token = ref(''), clientSecret = ref(''), tokenCleared = ref(false), secretCleared = ref(false)
const args = ref(draft.value.args.map(value => ({ value })))
const env = ref(Object.entries(draft.value.envRefs).map(([name, reference]) => ({ name, reference, value: '' })))
const headers = ref(Object.entries(draft.value.headers).map(([name, value]) => ({ name, value, reference: '' })))
const removedEnv = new Set<string>()
const advanced = ref(false)
const argsJson = ref(JSON.stringify(draft.value.args, null, 2))
const envJson = ref(JSON.stringify(draft.value.envRefs, null, 2))
const headersJson = ref(JSON.stringify(draft.value.headers, null, 2))
const result = ref<string[] | null>(null)
let draftLogin = false, saved = false, disposed = false
const remote = computed(() => draft.value.transport !== 'stdio')
const referenceNames = computed(() => {
  try {
    const h = !remote.value ? {} : advanced.value ? JSON.parse(headersJson.value) as Record<string,string> : Object.fromEntries(headers.value.map(row => [row.name,row.value]))
    const e = !remote.value && advanced.value ? JSON.parse(envJson.value) as Record<string,string> : {}
    return [...new Set([...Object.values(h).flatMap(value => [...String(value).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(match => match[1]!)), ...Object.values(e)])]
  } catch { return [] }
})
function rows<T extends {name:string}>(entries:T[], label:string) {
  const filled = entries.filter(row => row.name.trim())
  if (new Set(filled.map(row => row.name.trim().toLowerCase())).size !== filled.length) throw new Error(`${label}: ${t('名称不能重复。')}`)
  return filled
}
function headerConfiguration() {
  return Object.fromEntries(rows(headers.value,'Header').map(row => {
    if (row.value && !/\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(row.value)) row.reference ||= `HEADER_${crypto.randomUUID().replaceAll('-','')}`
    return [row.name.trim(),row.reference && row.value ? '${' + row.reference + '}' : row.value]
  }))
}
function headerRows(configuration: Record<string,string>) {
  return Object.entries(configuration).map(([name,value]) => {
    const reference = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value)?.[1]
    return reference && values.value[reference] ? {name,value:values.value[reference]!,reference} : {name,value,reference:''}
  })
}
function configuration(): PiMcpConnectionDto {
  const d = draft.value
  if (!d.name.trim()) throw new Error(t('请填写服务名称。'))
  if (props.connections.some(c => c.id === d.id && c.id !== initial?.id)) throw new Error(t('MCP ID 已存在'))
  if (d.id === 'computer_use') throw new Error(t('Computer Use 已内置，请使用上方开关，不要添加重复服务。'))
  return { ...d, name: d.name.trim(), auth: remote.value ? d.auth ?? 'none' : 'none',
    credentialRef: d.credentialRef || 'MCP_TOKEN', apiKeyHeader: d.apiKeyHeader || 'X-API-Key',
    args: remote.value ? [] : advanced.value ? JSON.parse(argsJson.value) as string[] : args.value.map(row => row.value),
    envRefs: remote.value ? {} : advanced.value ? JSON.parse(envJson.value) as Record<string,string>
      : Object.fromEntries(rows(env.value,t('环境变量')).map(row => [row.name.trim(),row.reference || `ENV_${row.name.trim()}`])),
    headers: !remote.value ? {} : advanced.value ? JSON.parse(headersJson.value) as Record<string,string>
      : headerConfiguration(),
    ...(d.auth === 'oauth' && (clientSecret.value || secretCleared.value || d.oauthClientSecretRef) ? {oauthClientSecretRef: d.oauthClientSecretRef || 'OAUTH_CLIENT_SECRET'} : {}),
  }
}
function updates(): Record<string,string|null> {
  const result = {...values.value}
  for (const reference of removedEnv) result[reference] = null
  if (!advanced.value) for (const row of env.value) if (row.name.trim() && row.value) result[row.reference || `ENV_${row.name.trim()}`] = row.value
  if (!advanced.value) for (const row of headers.value) if (row.name.trim() && row.reference && row.value) result[row.reference] = row.value
  if (token.value) result[draft.value.credentialRef || 'MCP_TOKEN'] = token.value
  else if (tokenCleared.value) result[draft.value.credentialRef || 'MCP_TOKEN'] = null
  if (clientSecret.value) result[draft.value.oauthClientSecretRef || 'OAUTH_CLIENT_SECRET'] = clientSecret.value
  else if (secretCleared.value) result[draft.value.oauthClientSecretRef || 'OAUTH_CLIENT_SECRET'] = null
  return Object.fromEntries(Object.entries(result).filter(([,value]) => value === null || value !== ''))
}
async function load() {
  if (!initial) return
  loading.value = true; loadError.value = ''
  try {
    const saved = await desktopApi.piMcpCredentials(initial.id)
    values.value = {...saved}
    // Recognize the common legacy Bearer template without requiring JSON edits.
    const authorization = headers.value.find(row => row.name.toLowerCase() === 'authorization')
    const match = !draft.value.auth || draft.value.auth === 'none' ? /^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(authorization?.value ?? '') : null
    if (match && authorization) {
      draft.value.auth = 'bearer'; draft.value.credentialRef = match[1]!
      headers.value = headers.value.filter(row => row !== authorization)
      headersJson.value = JSON.stringify(Object.fromEntries(headers.value.map(row => [row.name,row.value])), null, 2)
    }
    token.value = saved[draft.value.credentialRef || 'MCP_TOKEN'] ?? ''
    clientSecret.value = saved[draft.value.oauthClientSecretRef || 'OAUTH_CLIENT_SECRET'] ?? ''
    for (const row of env.value) row.value = saved[row.reference] ?? ''
    headers.value = headerRows(Object.fromEntries(headers.value.map(row => [row.name,row.value])))
  } catch (failure) { loadError.value = failure instanceof Error ? failure.message : String(failure) }
  finally { loading.value = false }
}
async function perform(operation:'save'|'test'|'login') {
  if (busy.value || loading.value || loadError.value || props.locked) return
  busy.value = true; error.value = ''; result.value = null
  try {
    const config = configuration(), credentials = updates()
    if (operation === 'test') {
      result.value = (await desktopApi.testPiMcp(config, credentials)).tools
      toast.success(t('连接成功，发现 {value0} 个工具；测试连接已关闭。',{value0:result.value.length}))
    } else if (operation === 'save') {
      await desktopApi.savePiMcpConnection(config, credentials)
      saved = true; toast.success(t('MCP 配置与凭据已保存。')); emit('saved')
    } else {
      draftLogin = true
      const login = await desktopApi.loginPiMcpDraft(config,credentials)
      if (disposed) { await desktopApi.cancelPiMcpLogin(config.id); return }
      try { await desktopApi.openAuthorizationUrl(login.url) }
      catch (failure) { await desktopApi.cancelPiMcpLogin(config.id); throw failure }
      toast.success(t('请在浏览器完成授权，然后测试连接或保存配置。'))
    }
  } catch (failure) { error.value = failure instanceof Error ? failure.message : String(failure) }
  finally { busy.value = false }
}
function toggleAdvanced(event: Event) {
  const requested = (event.target as HTMLInputElement).checked
  if (requested) {
    try { headersJson.value = JSON.stringify(headerConfiguration(),null,2); values.value = updates() }
    catch (failure) { error.value = String(failure); (event.target as HTMLInputElement).checked = false; return }
    argsJson.value = JSON.stringify(args.value.map(row => row.value),null,2)
    envJson.value = JSON.stringify(Object.fromEntries(env.value.filter(row => row.name.trim()).map(row => [row.name.trim(),row.reference || `ENV_${row.name.trim()}`])),null,2)
  } else {
    try {
      args.value = (JSON.parse(argsJson.value) as string[]).map(value => ({value}))
      env.value = Object.entries(JSON.parse(envJson.value) as Record<string,string>).map(([name,reference]) => ({name,reference,value:values.value[reference] ?? ''}))
      headers.value = headerRows(JSON.parse(headersJson.value) as Record<string,string>)
    } catch (failure) { error.value = String(failure); (event.target as HTMLInputElement).checked = true; return }
  }
  advanced.value = requested
}
onMounted(load)
onUnmounted(() => { disposed = true; if (draftLogin && !saved) void desktopApi.cancelPiMcpLogin(draft.value.id).catch(() => {}) })
</script>

<template>
  <section class="mt-3 rounded-xl border border-border bg-card p-4">
    <h3 class="mb-3 text-sm font-medium">{{ t(initial ? '编辑 MCP 服务' : '添加 MCP 服务') }}</h3>
    <p v-if="locked" class="mb-3 text-xs text-muted-foreground">{{ t('请先停止 Runtime，再编辑或测试服务。') }}</p>
    <p v-if="loading" class="mb-3 text-xs text-muted-foreground">{{ t('正在读取已保存的配置…') }}</p>
    <div v-if="loadError" class="mb-3 text-xs"><p role="alert" class="text-destructive">{{ loadError }}</p><Button size="sm" variant="outline" @click="load">{{ t('重新加载配置') }}</Button></div>
    <fieldset :disabled="locked || busy || loading || Boolean(loadError)" class="disabled:opacity-60">
      <FormGrid>
        <FormField :label="t('名称')" span="2"><input v-model="draft.name" :placeholder="t('文档服务')" type="text" /></FormField>
        <FormField :label="t('传输')" :span="remote ? '1' : '2'"><select v-model="draft.transport"><option value="http">Streamable HTTP</option><option value="sse">{{ t('HTTP + SSE（旧版）') }}</option><option value="stdio">{{ t('stdio · 本地子进程') }}</option></select></FormField>
        <template v-if="remote">
          <FormField :label="t('认证')"><select v-model="draft.auth"><option value="none">{{ t('无认证') }}</option><option value="bearer">Bearer Token</option><option value="api_key">API Key</option><option value="oauth">{{ t('OAuth 浏览器授权') }}</option></select></FormField>
          <FormField :label="t('MCP 地址')" span="2"><input v-model="draft.url" type="text" placeholder="https://example.com/mcp" /></FormField>
          <FormField v-if="draft.auth === 'api_key'" :label="t('密钥 Header 名称')" span="2"><input v-model="draft.apiKeyHeader" type="text" placeholder="X-API-Key" /></FormField>
          <FormField v-if="draft.auth === 'bearer' || draft.auth === 'api_key'" :label="draft.auth === 'bearer' ? 'Token' : 'API Key'" span="2">
            <InputGroup><InputGroupInput v-model="token" type="text" autocomplete="off" :placeholder="t('填写自己的服务密钥')" @update:model-value="tokenCleared = false" /><InputGroupButton :aria-label="t('清除')" @click="token = ''; tokenCleared = true"><Trash2 :size="15" /></InputGroupButton></InputGroup>
          </FormField>
          <div v-if="draft.auth === 'oauth'" class="col-span-2 space-y-3">
            <p class="text-xs leading-5 text-muted-foreground">{{ t('自动发现授权方式。已有客户端可填写下面的信息；无需统一托管 CIMD 文档。') }}</p>
            <details class="text-xs"><summary class="cursor-pointer">{{ t('OAuth 客户端配置（按服务要求填写）') }}</summary><FormGrid class="mt-3">
              <FormField :label="'Client ID ' + t('（可选）')" span="2"><input v-model="draft.oauthClientId" type="text" /></FormField>
              <FormField :label="'Client Secret ' + t('（可选）')" span="2"><InputGroup><InputGroupInput v-model="clientSecret" type="text" autocomplete="off" @update:model-value="secretCleared = false" /><InputGroupButton :aria-label="t('清除')" @click="clientSecret = ''; secretCleared = true"><Trash2 :size="15" /></InputGroupButton></InputGroup></FormField>
              <FormField :label="t('OAuth 回调地址（可选）')" span="2"><input v-model="draft.oauthRedirectUri" type="text" placeholder="http://127.0.0.1:18456/oauth/callback" /></FormField>
              <FormField :label="t('授权范围（可选）')"><input v-model="draft.oauthScopes" type="text" placeholder="files:read" /></FormField>
              <FormField :label="t('客户端认证方式')"><select v-model="draft.oauthTokenAuthMethod"><option value="auto">{{ t('自动选择') }}</option><option value="none">none</option><option value="client_secret_basic">client_secret_basic</option><option value="client_secret_post">client_secret_post</option></select></FormField>
              <FormField :label="t('CIMD 文档 URL（可选）')" span="2"><input v-model="draft.clientMetadataUrl" type="text" placeholder="https://your-domain.example/oauth/client.json" /></FormField>
            </FormGrid></details>
            <Button size="sm" variant="outline" @click="perform('login')">{{ t('授权登录') }}</Button>
          </div>
          <div v-if="!advanced" class="col-span-2 space-y-2">
            <span class="text-[11px] font-medium">{{ t('额外 Header') }}</span>
            <InputGroup v-for="(row,index) in headers" :key="index"><InputGroupInput v-model="row.name" :aria-label="t('Header 名称')" placeholder="Header" type="text" /><InputGroupInput v-model="row.value" :aria-label="t('Header 值')" class="border-l border-input" type="text" /><InputGroupButton :aria-label="t('移除')" @click="row.reference && removedEnv.add(row.reference); headers.splice(index,1)"><Trash2 :size="15" /></InputGroupButton></InputGroup>
            <Button variant="outline" size="sm" @click="headers.push({name:'',value:'',reference:''})">{{ t('添加 Header') }}</Button>
          </div>
        </template>
        <template v-else>
          <FormField :label="t('可执行程序')" span="2"><input v-model="draft.command" type="text" :placeholder="t('npx 或绝对路径（不是 shell 命令）')" /></FormField>
          <template v-if="!advanced">
            <div class="col-span-2 space-y-2"><span class="text-[11px] font-medium">{{ t('启动参数') }}</span><InputGroup v-for="(row,index) in args" :key="index"><InputGroupInput v-model="row.value" :aria-label="t('参数值')" type="text" /><InputGroupButton :aria-label="t('移除')" @click="args.splice(index,1)"><Trash2 :size="15" /></InputGroupButton></InputGroup><Button variant="outline" size="sm" @click="args.push({value:''})">{{ t('添加参数') }}</Button></div>
            <div class="col-span-2 space-y-2"><span class="text-[11px] font-medium">{{ t('环境变量') }}</span><InputGroup v-for="(row,index) in env" :key="index"><InputGroupInput v-model="row.name" :aria-label="t('环境变量名称')" placeholder="API_KEY" type="text" /><InputGroupInput v-model="row.value" :aria-label="t('环境变量值')" class="border-l border-input" :placeholder="row.reference ? '${' + row.reference + '}' : t('值')" type="text" /><InputGroupButton :aria-label="t('移除')" @click="row.reference && removedEnv.add(row.reference); env.splice(index,1)"><Trash2 :size="15" /></InputGroupButton></InputGroup><Button variant="outline" size="sm" @click="env.push({name:'',value:'',reference:''})">{{ t('添加环境变量') }}</Button></div>
          </template>
        </template>
        <details class="col-span-2 text-xs"><summary class="cursor-pointer">{{ t('高级配置') }}</summary><FormGrid class="mt-3">
          <FormField label="ID" span="2"><input v-model="draft.id" :disabled="Boolean(initial)" type="text" /></FormField>
          <label class="col-span-2 flex items-center gap-2"><input type="checkbox" :checked="advanced" @change="toggleAdvanced" />{{ t('使用高级 JSON 配置') }}</label>
          <template v-if="advanced"><FormField v-if="!remote" :label="t('参数 JSON 数组')" span="2"><textarea v-model="argsJson" class="h-20" /></FormField><FormField v-if="!remote" :label="t('环境变量引用 JSON')" span="2"><textarea v-model="envJson" class="h-20" /></FormField><FormField v-if="remote" :label="t('Header 引用 JSON')" span="2"><textarea v-model="headersJson" class="h-20" /></FormField></template>
        </FormGrid></details>
        <FormField v-for="reference in referenceNames" :key="reference" :label="reference" span="2"><InputGroup><InputGroupInput :model-value="values[reference] ?? ''" type="text" autocomplete="off" :placeholder="t('留空保留 / 使用服务环境变量')" @update:model-value="values[reference] = $event" /><InputGroupButton :aria-label="t('清除')" @click="values[reference] = null"><Trash2 :size="15" /></InputGroupButton></InputGroup></FormField>
      </FormGrid>
      <p v-if="error" role="alert" class="mt-3 whitespace-pre-wrap break-words text-xs text-destructive">{{ error }}</p>
      <div v-if="result" role="status" class="mt-3 rounded-md border border-input p-3 text-xs"><p>{{ t('发现 {value0} 个工具。',{value0:result.length}) }}</p><ul class="mt-2 max-h-40 overflow-auto font-mono"><li v-for="name in result" :key="name">{{ name }}</li></ul></div>
      <div class="mt-4 flex justify-end gap-2 border-t border-border pt-3.5"><Button size="sm" variant="outline" @click="emit('cancel')">{{ t('取消') }}</Button><Button size="sm" variant="outline" @click="perform('test')">{{ busy ? t('处理中…') : t('测试连接') }}</Button><Button size="sm" @click="perform('save')">{{ t('保存配置') }}</Button></div>
    </fieldset>
  </section>
</template>
