import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import 'virtual:uno.css'
import './styles.css'
import { initializeLocale } from './composables/useLocale'

initializeLocale()

const systemColorScheme = window.matchMedia('(prefers-color-scheme: dark)')
const syncSystemColorScheme = () => {
  document.documentElement.classList.toggle('dark', systemColorScheme.matches)
}

syncSystemColorScheme()
systemColorScheme.addEventListener('change', syncSystemColorScheme)

createApp(App).use(router).mount('#app')
