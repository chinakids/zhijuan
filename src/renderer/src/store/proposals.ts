// ===== 织卷 S4 · 提案状态（顶栏计数与抽屉共享） =====
import { create } from 'zustand'
import type { Proposal } from '../../../shared/types'

interface ProposalState {
  list: Proposal[]
  tick: number
  refresh: (projectId: string) => Promise<void>
  bump: () => void
  setList: (l: Proposal[]) => void
}

export const useProposalStore = create<ProposalState>((set) => ({
  list: [],
  tick: 0,
  refresh: async (projectId) => {
    try {
      const l = (await window.zhijuan.listProposals(projectId)) ?? []
      set({ list: l })
    } catch {
      // 静默：仅在极早期可能失败
    }
  },
  bump: () => set((s) => ({ tick: s.tick + 1 })),
  setList: (l) => set({ list: l })
}))
