import { create } from 'zustand'

interface UiStore {
  /** 键盘快捷键速查（系统菜单 帮助→键盘快捷键速查 全局入口；CommandPalette / Settings 页内实例保留各自本地态） */
  shortcutHelpOpen: boolean
  setShortcutHelpOpen: (v: boolean) => void
}

export const useUiStore = create<UiStore>((set) => ({
  shortcutHelpOpen: false,
  setShortcutHelpOpen: (v) => set({ shortcutHelpOpen: v })
}))
