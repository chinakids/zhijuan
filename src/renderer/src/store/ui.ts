import { create } from 'zustand'

interface UiStore {
  /** 键盘快捷键速查（系统菜单 帮助→键盘快捷键速查 全局入口；CommandPalette / Settings 页内实例保留各自本地态） */
  shortcutHelpOpen: boolean
  setShortcutHelpOpen: (v: boolean) => void
  /** Agent 面板实时宽度（px；null=组件未挂载/未知）。供窄窗判据等跨组件读取，与 AppSettings 持久化互补 */
  agentPanelWidth: number | null
  setAgentPanelWidth: (v: number) => void
  /**
   * 应用级「当前写作章」（2026-09-20 体验层）：正文页当前选中章在路由切换后保留的应用级工作上下文。
   * 服务两处：①大纲区章卡行「正在写」指示（跨页状态）；②切回正文页自动恢复上次所选章。
   * 会话内状态不做持久化（工作上下文非界面偏好）；projectId 防跨项目串章。
   */
  currentChapter: { projectId: string; file: string } | null
  setCurrentChapter: (v: { projectId: string; file: string } | null) => void
}

export const useUiStore = create<UiStore>((set) => ({
  shortcutHelpOpen: false,
  setShortcutHelpOpen: (v) => set({ shortcutHelpOpen: v }),
  agentPanelWidth: null,
  setAgentPanelWidth: (v) => set({ agentPanelWidth: v }),
  currentChapter: null,
  setCurrentChapter: (v) => set({ currentChapter: v })
}))
