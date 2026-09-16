import { create } from 'zustand'
import type { TodoItem, AskQuestion, EditItem } from '../../../../shared/types'

export interface AgentMsg {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  quote?: string
  applied?: boolean
  error?: boolean
  /** 思考过程（本轮 assistant 消息上可折叠展示） */
  thinking?: string
  /** tool 角色的卡片类型 */
  kind?: 'todo' | 'ask' | 'meta' | 'edit'
  items?: TodoItem[]
  questions?: AskQuestion[]
  batch?: string
  /** meta 卡：工具名与参数展示 */
  tool?: string
  toolArgs?: string
  /** meta 卡：完整参数 JSON 与完整结果正文（「细节展开」用，默认折叠） */
  toolArgsJson?: string
  toolResult?: string
  done?: boolean
  /** meta 卡：工具结果是否成功（done 后才有意义；false=失败态） */
  toolOk?: boolean
  /** meta 卡：工具开始时刻（performance.now）与耗时（meta-done 时计算，ms） */
  startedAt?: number
  elapsedMs?: number
  /** meta 卡：轮次以停止/错误终了时该工具仍未返回结果（渲染「已取消」中性终态，停转圈） */
  cancelled?: boolean
  /** edit 卡：目标文件与修改条目 */
  file?: string
  edits?: EditItem[]
  /** ask 卡是否已提交 */
  answered?: boolean
  /** edit 卡：采纳/拒绝态 */
  editState?: 'pending' | 'applied' | 'rejected' | 'error'
  editError?: string
  /**
   * 本轮错误文案（2026-09-16 智能层候选3）：错误时 content 保留已流式内容/思考，错误文案独立存这里；
   * 旧「append 错误」路径（巡查/导演等直接 append）无此字段——content 即错误文案（bare 路径）。
   */
  errorText?: string
  /** 错误时可一键重试的载荷（原 prompt/quote/focus），仅在 send 路径的错误上存在 */
  errorRetry?: { prompt: string; quote: string | null; focus: boolean }
  /** 错误气泡已被手动重试过（按钮置「已重试」，防连点重复发轮） */
  retried?: boolean
}

interface AgentState {
  messages: AgentMsg[]
  streaming: boolean
  quote: string | null
  setStreaming: (v: boolean) => void
  setQuote: (q: string | null) => void
  append: (m: Omit<AgentMsg, 'id'>) => void
  patch: (id: string, content: string) => void
  setError: (id: string, text: string, retryMeta?: { prompt: string; quote: string | null; focus: boolean }) => void
  /** 标记某条错误消息已被手动重试（重试按钮置「已重试」） */
  markRetried: (id: string) => void
  markApplied: (id: string) => void
  /** 向消息追加思考增量（assistant 消息；仅在存在时追加） */
  appendThinking: (id: string, text: string) => void
  /** upsert 一个 tool 消息（按 id）：todo 用全量替换，ask 用新增，meta 标记工具活动，edit 落正文修改卡 */
  upsertTool: (m: Omit<AgentMsg, 'role' | 'id' | 'content'> & { id: string; content?: string }) => void
  /** 标记某个编辑卡的状态 */
  setEditState: (id: string, state: 'applied' | 'rejected' | 'error', error?: string) => void
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
  setError: (id, text, retryMeta) =>
    set((s) => ({
      messages: s.messages.map((x) =>
        x.id === id
          ? {
              ...x,
              error: true,
              errorText: text,
              ...(retryMeta ? { errorRetry: retryMeta } : {})
            }
          : x
      )
    })),
  markRetried: (id) =>
    set((s) => ({
      messages: s.messages.map((x) => (x.id === id ? { ...x, retried: true } : x))
    })),
  markApplied: (id) => set((s) => ({ messages: s.messages.map((x) => (x.id === id ? { ...x, applied: true } : x)) })),
  appendThinking: (id, text) => set((s) => ({ messages: s.messages.map((x) => (x.id === id ? { ...x, thinking: (x.thinking ?? '') + text } : x)) })),
  upsertTool: (m) =>
    set((s) => {
      const idx = s.messages.findIndex((x) => x.id === m.id)
      const next = { ...m, role: 'tool' as const, content: m.content ?? '' }
      if (idx >= 0) {
        const copy = s.messages.slice()
        copy[idx] = { ...copy[idx], ...next }
        return { messages: copy }
      }
      return { messages: [...s.messages, next] }
    }),
  setEditState: (id, state, error) =>
    set((s) => ({ messages: s.messages.map((x) => (x.id === id ? { ...x, editState: state, editError: error } : x)) })),
  markAsked: (id) => set((s) => ({ messages: s.messages.map((x) => (x.id === id ? { ...x, answered: true } : x)) })),
  reset: () => set({ messages: [], quote: null })
}))
