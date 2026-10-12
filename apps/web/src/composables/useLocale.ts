import { computed, ref, watch } from 'vue'
import { LOCALE_STORAGE_KEY, readLocale, translate, validLocale, type AppLocale } from '../lib/i18n'

export const locale = ref<AppLocale>('zh-CN')
export const dateLocale = computed(() => locale.value === 'en' ? 'en-US' : 'zh-CN')
export const t = (message: string, values?: Readonly<Record<string, string | number>>) => translate(message, locale.value, values)

function syncDocument() {
  if (typeof document !== 'undefined') document.documentElement.lang = locale.value
}
watch(locale, syncDocument, { flush: 'sync' })

export function initializeLocale() {
  try { locale.value = readLocale(typeof window === 'undefined' ? undefined : window.localStorage) }
  catch { locale.value = 'zh-CN' }
  syncDocument()
}

export function setLocale(value: unknown): boolean {
  if (!validLocale(value)) return false
  locale.value = value
  try { if (typeof window !== 'undefined') window.localStorage.setItem(LOCALE_STORAGE_KEY, value) }
  catch { /* Keep the in-memory choice when WebView storage is unavailable. */ }
  return true
}

export function useLocale() { return { locale, dateLocale, t, setLocale } }
