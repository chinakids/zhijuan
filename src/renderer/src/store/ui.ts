import { create } from 'zustand'

interface UiStore {
  /** 键盘快捷键速查（系统菜单 帮助→键盘快捷键速查 全局入口；CommandPalette / Settings 页内实例保留各自本地态） */
  shortcutHelpOpen: boolean
  setShortcutHelpOpen: (v: boolean) => void
  /** Agent 面板实时宽度（px；null=组件未挂载/未知）。供窄窗判据等跨组件读取，与 AppSettings 持久化互补 */
  agentPanelWidth: number | null
  setAgentPanelWidth: (v: number) => void
}

export const useUiStore = create<UiStore>((set) => ({
  shortcutHelpOpen: false,
  setShortcutHelpOpen: (v) => set({ shortcutHelpOpen: v }),
  agentPanelWidth: null,
  setAgentPanelWidth: (v) => set({ agentPanelWidth: v })
}))
