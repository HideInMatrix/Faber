<script setup lang="ts">
import { t } from '../../composables/useLocale'

import { computed } from 'vue'
import { Check, Copy, Eye, EyeOff, FolderOpen, Globe2, Play, Server, ShieldCheck, RotateCcw, Square, Trash2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { CheckField, FormField, FormGrid } from '@/components/ui/form'
import { InputGroup, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import type { NetworkProviderDto, RuntimeDraft } from '../../types'
import PermissionModeField from './PermissionModeField.vue'

const draft = defineModel<RuntimeDraft>('draft', { required: true })
const tunnelTokenVisible = defineModel<boolean>('tunnelTokenVisible', { required: true })

const props = defineProps<{
  locked: boolean
  busy: boolean
  lifecycleBusy: boolean
  lifecycleAction: 'start' | 'stop' | null
  selectedRunning: boolean
  copiedUrl: string
  runtimeUrl: string
  networkProviders: NetworkProviderDto[]
  oauthPasswordVisible: boolean
}>()

const selectedProvider = computed(() => (
  props.networkProviders.find(item => item.key === draft.value.network.provider)
))
const hasProtocolOption = computed(() => selectedProvider.value?.options.some(field => field.key === 'protocol') ?? false)

function secretConfigured(key: string) {
  return draft.value.network.configured_secrets.includes(key)
}

function updateNetworkChoice(key: string, event: Event) {
  draft.value.network.options[key] = (event.target as HTMLSelectElement).value
}

// Use the emitted new value: a forwarded native input listener can run before
// v-model updates, misclassifying a first paste as an unchanged empty secret.
function updateNetworkSecret(key: string, value: string) {
  draft.value.network.options[key] = value
  draft.value.network.secret_actions[key] = value ? 'set' : 'unchanged'
}

function toggleNetworkSecretClear(key: string) {
  const clearing = draft.value.network.secret_actions[key] === 'clear'
  draft.value.network.options[key] = ''
  draft.value.network.secret_actions[key] = clearing ? 'unchanged' : 'clear'
}

function updateOAuthPassword(value: string) {
  draft.value.oauth_password = value
  draft.value.oauth_password_action = value ? 'set' : 'unchanged'
}

function toggleOAuthPasswordClear() {
  const clearing = draft.value.oauth_password_action === 'clear'
  draft.value.oauth_password = ''
  draft.value.oauth_password_action = clearing ? 'unchanged' : 'clear'
}

const emit = defineEmits<{
  chooseWorkspace: []
  toggleOAuthPassword: []
  copyUrl: [value: string]
  save: []
  toggleRunning: []
}>()
</script>

<template>
  <div class="runtime-workspace">
    <aside class="connection-panel runtime-actions" :aria-label="t('连接与运行')">
      <div class="connection-heading"><span class="connection-tag">MCP</span><h2>{{ t("连接地址") }}</h2></div>
      <div class="connection-address">
        <code v-if="runtimeUrl" class="connection-url">{{ runtimeUrl }}</code>
        <p v-else class="connection-url connection-empty">{{ t("启动后显示连接地址") }}</p>
        <Button variant="ghost" size="icon" class="copy-address" :title="t('复制 MCP 地址')" :disabled="!runtimeUrl" :aria-label="t('复制 MCP 地址')" @click="emit('copyUrl', runtimeUrl)">
          <Check v-if="runtimeUrl && copiedUrl === runtimeUrl" :size="16" /><Copy v-else :size="16" />
        </Button>
      </div>
      <div class="runtime-button-row">
        <Button variant="outline" class="runtime-save-button" :disabled="busy || lifecycleBusy || locked" @click="emit('save')">{{ t("保存") }}</Button>
        <Button class="runtime-start-button" :variant="selectedRunning ? 'destructiveOutline' : 'default'" :disabled="busy || lifecycleAction === 'stop'" @click="emit('toggleRunning')">
          <Square v-if="selectedRunning || lifecycleAction === 'start'" :size="16" /><Play v-else :size="16" />
          {{ lifecycleAction === 'stop' ? t("停止中…") : lifecycleAction === 'start' ? t("取消启动") : selectedRunning ? t("停止") : t("启动") }}
        </Button>
      </div>
    </aside>
    <section class="settings-panel runtime-basic-panel" aria-labelledby="runtime-basic-title">
      <div class="panel-heading"><span class="section-icon"><Server :size="18" /></span><h2 id="runtime-basic-title">{{ t("基础配置") }}</h2></div>
      <FormGrid class="runtime-basic-grid">
        <FormField :label="t('Runtime 名称')">
          <input v-model.trim="draft.name" :disabled="locked" :placeholder="t('例如：Faber Runtime')" />
        </FormField>
        <FormField :label="t('监听地址')"><input v-model.trim="draft.host" disabled /></FormField>
        <FormField :label="t('本地端口')">
          <input v-model.number="draft.port" :disabled="locked" type="number" min="1" max="65535" />
        </FormField>

        <FormField :label="t('工作目录')" class="runtime-workspace-field">
          <InputGroup>
            <InputGroupInput v-model="draft.workspace" :disabled="locked" />
            <InputGroupButton
              :disabled="locked"
              :aria-label="t('选择 Runtime 工作目录')"
              :title="t('选择 Runtime 工作目录')"
              @click="emit('chooseWorkspace')"
            ><FolderOpen :size="15" /></InputGroupButton>
          </InputGroup>
        </FormField>
      </FormGrid>
    </section>
    <section class="settings-panel runtime-network-panel" aria-labelledby="runtime-network-title">
      <div class="panel-heading"><span class="section-icon"><Globe2 :size="18" /></span><h2 id="runtime-network-title">{{ t("网络连接") }}</h2></div>
      <FormGrid>
        <FormField :label="t('公网域名')" span="2">
          <input
            v-model.trim="draft.network.public_url"
            :disabled="locked || selectedProvider?.supports_public_url === false"
            :placeholder="t('例如 https://mcp.example.com')"
          />
        </FormField>

        <FormField :label="t('网络方案')" :span="hasProtocolOption ? '1' : '2'">
          <select v-model="draft.network.provider" :disabled="locked">
            <option v-for="provider in networkProviders" :key="provider.key" :value="provider.key">
              {{ t(provider.label) }}
            </option>
          </select>
        </FormField>

        <FormField
          v-for="field in selectedProvider?.options || []"
          :key="field.key"
          :label="t(field.label)"
          :span="field.key === 'protocol' ? '1' : field.span"
        >
          <div v-if="field.secret" class="grid gap-2">
            <InputGroup>
              <InputGroupInput
                :model-value="draft.network.options[field.key]"
                :disabled="locked || draft.network.secret_actions[field.key] === 'clear'"
                :type="tunnelTokenVisible ? 'text' : 'password'"
                autocomplete="new-password"
                :placeholder="t('留空则保留现有值')"
                @update:model-value="updateNetworkSecret(field.key, $event)"
              />
              <InputGroupButton
                :aria-label="tunnelTokenVisible ? t('隐藏网络密钥') : t('显示网络密钥')"
                :aria-pressed="tunnelTokenVisible"
                :title="tunnelTokenVisible ? t('隐藏网络密钥') : t('显示网络密钥')"
                @click="tunnelTokenVisible = !tunnelTokenVisible"
              ><EyeOff v-if="tunnelTokenVisible" :size="15" /><Eye v-else :size="15" /></InputGroupButton>
              <InputGroupButton
                :disabled="locked || (!secretConfigured(field.key) && !draft.network.options[field.key])"
                :aria-label="draft.network.secret_actions[field.key] === 'clear' ? t('撤销清除网络密钥') : t('清除网络密钥')"
                :title="draft.network.secret_actions[field.key] === 'clear' ? t('撤销清除') : t('保存时清除')"
                @click="toggleNetworkSecretClear(field.key)"
              ><RotateCcw v-if="draft.network.secret_actions[field.key] === 'clear'" :size="15" /><Trash2 v-else :size="15" /></InputGroupButton>
            </InputGroup>
          </div>
          <select
            v-else-if="field.choices"
            :value="draft.network.options[field.key] || field.default_value"
            :disabled="locked"
            @change="updateNetworkChoice(field.key, $event)"
          >
            <option v-for="choice in field.choices" :key="choice.value" :value="choice.value">
              {{ t(choice.label) }}
            </option>
          </select>
          <input
            v-else
            v-model.trim="draft.network.options[field.key]"
            :disabled="locked"
            type="text"
            autocomplete="off"
          />
          <details v-if="field.description" class="text-xs font-normal text-muted-foreground">
            <summary class="cursor-pointer">{{ t("配置说明") }}</summary>
            <p class="mt-1 leading-5">{{ t(field.description) }}</p>
          </details>
        </FormField>
      </FormGrid>
    </section>
    <section class="settings-panel runtime-access-panel" aria-labelledby="runtime-access-title">
      <div class="panel-heading"><span class="section-icon"><ShieldCheck :size="18" /></span><h2 id="runtime-access-title">{{ t("访问控制") }}</h2></div>
      <FormGrid class="runtime-access-grid">
        <FormField :label="t('OAuth 密码')">
          <div class="grid gap-2">
            <InputGroup>
              <InputGroupInput
                :model-value="draft.oauth_password"
                :disabled="locked || draft.oauth_password_action === 'clear'"
                :type="oauthPasswordVisible ? 'text' : 'password'"
                autocomplete="new-password"
                :placeholder="t('留空则保留现有值')"
                @update:model-value="updateOAuthPassword"
              />
              <InputGroupButton
                :aria-label="oauthPasswordVisible ? t('隐藏 OAuth 密码') : t('显示 OAuth 密码')"
                :aria-pressed="oauthPasswordVisible"
                :title="oauthPasswordVisible ? t('隐藏 OAuth 密码') : t('显示 OAuth 密码')"
                @click="emit('toggleOAuthPassword')"
              ><EyeOff v-if="oauthPasswordVisible" :size="15" /><Eye v-else :size="15" /></InputGroupButton>
              <InputGroupButton
                :disabled="locked || (!draft.oauth_password_configured && !draft.oauth_password)"
                :aria-label="draft.oauth_password_action === 'clear' ? t('撤销清除 OAuth 密码') : t('清除 OAuth 密码')"
                :title="draft.oauth_password_action === 'clear' ? t('撤销清除') : t('保存时清除')"
                @click="toggleOAuthPasswordClear"
              ><RotateCcw v-if="draft.oauth_password_action === 'clear'" :size="15" /><Trash2 v-else :size="15" /></InputGroupButton>
            </InputGroup>
          </div>
        </FormField>

        <PermissionModeField v-model="draft.permission_mode" :disabled="locked" />

        <CheckField class="runtime-remember-secrets"><input v-model="draft.remember_secrets" type="checkbox" /><span>{{ t("在本机保存网络令牌与 OAuth 密码") }}</span></CheckField>
      </FormGrid>
    </section>
  </div>
</template>
