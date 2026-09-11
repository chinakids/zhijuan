import { create } from 'zustand'
import type { AppSettings } from '../../../shared/types'

interface AppStore {
  settings: AppSettings | null
  /** 设置读取失败信息（空=无错）。读取失败不静默回退默认值，避免用户改动后覆盖原设置。 */
  settingsErr: string
  loadSettings: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
}

export const useAppStore = create<AppStore>((set, get) => ({
  settings: null,
  settingsErr: '',
  loadSettings: async () => {
    try {
      const s = await window.zhijuan.getSettings()
      set({ settings: s, settingsErr: '' })
      document.documentElement.classList.toggle('dark', s.theme === 'dark')
    } catch (e) {
      set({ settingsErr: String((e as Error).message ?? e) })
    }
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
