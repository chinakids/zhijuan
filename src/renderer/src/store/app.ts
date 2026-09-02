import { create } from 'zustand'
import type { AppSettings } from '../../../shared/types'

interface AppStore {
  settings: AppSettings | null
  loadSettings: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
}

export const useAppStore = create<AppStore>((set, get) => ({
  settings: null,
  loadSettings: async () => {
    const s = await window.zhijuan.getSettings()
    set({ settings: s })
    document.documentElement.classList.toggle('dark', s.theme === 'dark')
  },
  updateSettings: async (patch) => {
    const s = await window.zhijuan.setSettings(patch)
    set({ settings: s })
    document.documentElement.classList.toggle('dark', s.theme === 'dark')
  }
}))

/** 变更时应用主题 */
export function applyTheme(theme: 'paper' | 'dark') {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}
