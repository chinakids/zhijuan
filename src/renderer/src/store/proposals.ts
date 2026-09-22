// ===== 织卷 S4 · 提案状态（顶栏计数与抽屉共享） =====
import { create } from 'zustand'
import type { Proposal } from '../../../shared/types'
import { pruneErrMap, setErrInto } from './proposalErr'

interface ProposalState {
  list: Proposal[]
  tick: number
  /** 当前列表所属项目（2026-09-22 体验层 stale 核查）：切项目时先清列表防旧项目提案残留/计数误显 */
  projectId: string | null
  // 提案级错误（proposalId→err）：2026-09-17 从 ProposalDrawer 组件本地迁入 store——
  // IO/系统失败保持 pending 后失败卡是「可恢复资源」，关抽屉重开红字不能丢（只靠 toast 记忆，
  // 作者无从知道「这条为什么还在待确认」）；挂 store 跨开合/跨页保留，成功/拒绝/过期/列表消失时清除。
  // 纯逻辑在 ./proposalErr（tsconfig.node 白名单，可单测）；本文件含 window.zhijuan 只走 web 项目。
  errMap: Record<string, string>
  refresh: (projectId: string) => Promise<void>
  bump: () => void
  setList: (l: Proposal[]) => void
  setErr: (id: string, msg: string) => void
}

export const useProposalStore = create<ProposalState>((set) => ({
  list: [],
  tick: 0,
  projectId: null,
  errMap: {},
  refresh: async (projectId) => {
    try {
      // 切项目先清旧列表（2026-09-22 体验层 stale 核查）：新项目加载窗口不得显示旧项目提案/侧栏计数
      set((s) => (s.projectId === projectId ? s : { projectId, list: [], errMap: {} }))
      const l = (await window.zhijuan.listProposals(projectId)) ?? []
      set((s) => ({
        projectId,
        list: l,
        // 列表收敛后剔除已不存在提案的错误残留（提案文件被删/清除后 err 不应幽灵存活）
        errMap: pruneErrMap(s.errMap, new Set(l.map((p) => p.id)))
      }))
    } catch {
      // 静默：仅在极早期可能失败
    }
  },
  bump: () => set((s) => ({ tick: s.tick + 1 })),
  setList: (l) => set({ list: l }),
  setErr: (id, msg) => set((s) => ({ errMap: setErrInto(s.errMap, id, msg) }))
}))
