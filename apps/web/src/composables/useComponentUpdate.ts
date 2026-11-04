import { ref } from 'vue'

// Prevent an app relaunch in the middle of installing a component.
export const componentUpdateBusy = ref(false)
