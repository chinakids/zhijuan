import { create } from 'zustand'
import type { TodoItem, AskQuestion } from '../../../../shared/types'

export interface AgentMsg {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  quote?: string
  applied?: boolean
  error?: boolean
  /** tool 角色的卡片类型 */
  kind?: 'todo' | 'ask'
  items?: TodoItem[]
  questions?: AskQuestion[]
  batch?: string
  /** ask 卡是否已提交 */
  answered?: boolean
}

interface AgentState {
  messages: AgentMsg[]
  streaming: boolean
  quote: string | null
  setStreaming: (v: boolean) => void
  setQuote: (q: string | null) => void
  append: (m: Omit<AgentMsg, 'id'>) => void
  patch: (id: string, content: string) => void
  setError: (id: string, text: string) => void
  markApplied: (id: string) => void
  /** upsert 一个 tool 消息（按 id）：todo 用全量替换，ask 用新增 */
  upsertTool: (m: Omit<AgentMsg, 'role' | 'content' | 'id'> & { id: string }) => void
  markAsked: (id: string) => void
  reset: () => void
}

let n = 0
const nid = () => 'm' + Date.now().toString(36) + (n++).toString(36)

export const useAgentStore = create<AgentState>((set) => ({
  messages: [],
  streaming: false,
  quote: null,
  setStreaming: (v) => set({ streaming: v }),
  setQuote: (q) => set({ quote: q }),
  append: (m) => set((s) => ({ messages: [...s.messages, { ...m, id: nid() }] })),
  patch: (id, content) => set((s) => ({ messages: s.messages.map((x) => (x.id === id ? { ...x, content } : x)) })),
  setError: (id, text) => set((s) => ({ messages: s.messages.map((x) => (x.id === id ? { ...x, content: text, error: true } : x)) })),
  markApplied: (id) => set((s) => ({ messages: s.messages.map((x) => (x.id === id ? { ...x, applied: true } : x)) })),
  upsertTool: (m) =>
    set((s) => {
      const idx = s.messages.findIndex((x) => x.id === m.id)
      const next = { ...m, role: 'tool' as const, content: '' }
      if (idx >= 0) {
        const copy = s.messages.slice()
        copy[idx] = { ...copy[idx], ...next }
        return { messages: copy }
      }
      return { messages: [...s.messages, next] }
    }),
  markAsked: (id) => set((s) => ({ messages: s.messages.map((x) => (x.id === id ? { ...x, answered: true } : x)) })),
  reset: () => set({ messages: [], quote: null })
}))
