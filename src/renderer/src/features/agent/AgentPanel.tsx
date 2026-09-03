import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2, Quote, Paperclip, RotateCcw, Send } from 'lucide-react'
import type { ProseApi } from '../editor/Prose'
import { useAppStore } from '../../store/app'
import { useAgentStore } from './store'
import { buildAgentContext } from './context'
import { streamChat, type ChatMessage } from './llm'
import { sendAgent as harnessSend, cancelAgent, attachAgentBridge } from './harness'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'

interface AgentPanelProps {
  projectId: string
  chapterRel: string | null
  chapterTitle: string
  editorApi: () => ProseApi | null
}

const CHAR_LIMIT = 60000 // 上下文预算：首屏截断，超长走尾部
let ridSeq = 0
const newRid = () => 'r' + Date.now().toString(36) + (ridSeq++).toString(36)

function useSender(props: AgentPanelProps) {
  const setStreaming = useAgentStore((s) => s.setStreaming)
  const streaming = useAgentStore((s) => s.streaming)
  const abortRef = useRef<{ kind: 'harness' | 'legacy'; rid: string; ctrl?: AbortController } | null>(null)

  const send = useCallback(
    async (raw: string, quote: string | null) => {
      const { projectId, chapterRel } = props
      if (streaming || !raw.trim()) return
      const settings = useAppStore.getState().settings
      const llm = settings?.llm
      if (!llm?.baseUrl) {
        useAgentStore.getState().append({ role: 'assistant', content: '还没有配置 LLM 端点：设置 → 大模型（默认 127.0.0.1:8888）。', error: true })
        return
      }
      const engine = settings?.agentEngine ?? 'harness'
      const content = quote ? `（引用自《${props.chapterTitle}》选中段落）\n> ${quote.replace(/\n/g, '\n> ')}\n\n${raw}` : raw
      useAgentStore.getState().append({ role: 'user', content, quote: quote ?? undefined })
      useAgentStore.getState().append({ role: 'assistant', content: '' })
      setStreaming(true)
      const rid = newRid()
      const patch = (t: string, trunc = true) => {
        const msgs = useAgentStore.getState().messages
        const last = msgs[msgs.length - 1]
        if (!last) return
        const v = trunc && t.length > CHAR_LIMIT ? t.slice(0, CHAR_LIMIT) + '…（截断）' : t
        useAgentStore.getState().patch(last.id, v)
      }
      const fail = (txt: string) => {
        const msgs = useAgentStore.getState().messages
        useAgentStore.getState().setError(msgs[msgs.length - 1].id, txt)
      }
      try {
        if (engine === 'harness') {
          attachAgentBridge()
          abortRef.current = { kind: 'harness', rid }
          // 可见历史（去掉刚 push 的最后一条 user + 空 assistant）由引擎拼进上下文
          const history = useAgentStore
            .getState()
            .messages.slice(0, -2)
            .slice(-20)
            .map((m) => ({ role: m.role, content: m.content }))
          const r = await harnessSend(
            {
              requestId: rid,
              projectId,
              chapterRel: chapterRel ?? null,
              chapterTitle: props.chapterTitle,
              prompt: raw,
              quote: quote ?? null,
              history
            },
            (e) => {
              if (e.type === 'delta') patch((useAgentStore.getState().messages.at(-1)?.content ?? '') + e.text, false)
              else if (e.type === 'final') patch(e.text ?? '')
              else if (e.type === 'error') fail('请求失败：' + (e.message ?? ''))
            }
          )
          if (r === 'aborted') patch((useAgentStore.getState().messages.at(-1)?.content ?? '') + '\n\n（已停止）')
        } else {
          // legacy 直连（可随时回切的老引擎）
          const ctrl = new AbortController()
          abortRef.current = { kind: 'legacy', rid, ctrl }
          const { prompt } = await buildAgentContext(projectId, chapterRel ?? '')
          const history: ChatMessage[] = (() => {
            const msgs = useAgentStore.getState().messages
            const past = msgs.slice(0, -1).slice(-30).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
            return [{ role: 'system', content: prompt }, ...past]
          })()
          let out = ''
          await streamChat({
            baseUrl: llm.baseUrl,
            model: llm.model,
            apiKey: llm.apiKey,
            messages: history,
            onToken: (t) => {
              out += t
              patch(out)
            },
            signal: ctrl.signal
          })
          patch(out)
        }
      } catch (e) {
        fail('请求失败：' + String((e as Error).message || e))
      } finally {
        setStreaming(false)
        abortRef.current = null
        useAgentStore.getState().setQuote(null)
      }
    },
    [props, streaming]
  )

  const stop = useCallback(() => {
    const a = abortRef.current
    if (!a) return
    if (a.kind === 'harness') cancelAgent(a.rid)
    else a.ctrl?.abort()
  }, [])

  return { send, stop, streaming }
}

export default function AgentPanel(props: AgentPanelProps) {
  const messages = useAgentStore((s) => s.messages)
  const quote = useAgentStore((s) => s.quote)
  const streaming = useAgentStore((s) => s.streaming)
  const [input, setInput] = useState('')
  const { send, stop, streaming: sending } = useSender(props)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streaming])

  function grabQuote() {
    const api = props.editorApi()
    const sel = api?.getSelected()
    if (sel) useAgentStore.getState().setQuote(sel)
  }
  function applyText(msgs: { id: string; content: string }) {
    const api = props.editorApi()
    if (!api) return
    const hasSel = !!api.getSelected()
    api.applyMarkdown(msgs.content, hasSel)
    useAgentStore.getState().markApplied(msgs.id)
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-hair bg-surface-2">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hair px-4">
        <span className="text-sm font-medium text-ink">Agent</span>
        <span className="text-[11px] text-ink-3">本地模型 · 上下文按章节装配</span>
        <span className="flex-1" />
        <button title="清空对话" onClick={() => useAgentStore.getState().reset()} className="text-ink-3 hover:text-ink">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <p className="px-2 py-10 text-center text-xs leading-5 text-ink-3">
            在右侧和 agent 边聊边生成。
            <br />
            先选中正文某段 → 「引用选中」，或直接输入指令。
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[92%] rounded-xl px-3 py-2 text-[13px] leading-relaxed',
                m.role === 'user' ? 'bg-accent text-accent-ink' : 'border border-hair bg-surface text-ink'
              )}
            >
              {m.quote && (
                <blockquote className="mb-1.5 rounded bg-surface-2 px-2 py-1 text-[11px] text-ink-2" style={{ whiteSpace: 'pre-wrap' }}>
                  {m.quote.slice(0, 300)}
                  {m.quote.length > 300 ? '…' : ''}
                </blockquote>
              )}
              {m.role === 'assistant' ? (
                <div className="prose">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || (m.error ? '' : '…')}</ReactMarkdown>
                  {m.error && <span className="text-danger">（{m.content}）</span>}
                </div>
              ) : (
                <span className="whitespace-pre-wrap">{m.content}</span>
              )}
              {m.role === 'assistant' && !m.error && m.content && (
                <div className="mt-2 flex items-center gap-2">
                  <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" onClick={() => applyText(m)} disabled={!props.chapterRel}>
                    {m.applied ? '✓ 已应用' : '应用到正文'}
                  </Button>
                  {m.applied && <span className="text-[11px] text-ink-3">保存以保留（⌘S）</span>}
                </div>
              )}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="flex items-center gap-2 px-2 text-[11px] text-ink-3">
            <Loader2 className="h-3 w-3 animate-spin" /> 生成中…
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-hair p-3">
        {quote && (
          <div className="mb-2 flex items-start gap-1.5 rounded bg-surface px-2 py-1.5 text-[11px] text-ink-2">
            <Quote className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="line-clamp-2 flex-1">{quote}</span>
            <button onClick={() => useAgentStore.getState().setQuote(null)} className="text-ink-3 hover:text-ink">×</button>
          </div>
        )}
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="h-8 shrink-0 px-2" title="把编辑器里选中的段落作为引用" onClick={grabQuote}>
            <Paperclip className="h-3.5 w-3.5" />
            <span className="ml-1">引用选中</span>
          </Button>
        </div>
        <div className="mt-2 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                const v = input
                setInput('')
                void send(v.trim(), quote)
              }
            }}
            placeholder="让 agent 续写 / 改写 / 查设定…（Enter 发送）"
            className="max-h-40 min-h-[64px] flex-1 resize-none rounded-lg border border-hair bg-surface px-2.5 py-2 text-[13px] text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {streaming ? (
            <Button size="sm" className="h-9 shrink-0" variant="outline" onClick={stop}>
              停止
            </Button>
          ) : (
            <Button size="sm" className="h-9 shrink-0" onClick={() => { const v = input; setInput(''); void send(v.trim(), quote) }} disabled={!input.trim()}>
              <Send className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </aside>
  )
}
