import { create } from 'zustand'

export interface AgentMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  quote?: string
  applied?: boolean
  error?: boolean
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
  reset: () => set({ messages: [], quote: null })
}))
