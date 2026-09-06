import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2, Quote, Paperclip, RotateCcw, Send, ShieldAlert, BookOpenCheck, Check, X, Brain, Square, FileText, ChevronRight, Users } from 'lucide-react'
import type { ProseApi } from '../editor/Prose'
import type { AuditKind, EditItem } from '../../../../shared/types'
import { useAgentStore } from './store'
import { sendAgent as harnessSend, cancelAgent, attachAgentBridge } from './harness'
import TodoCard from './TodoCard'
import AskCard from './AskCard'
import AuditDrawer from '../audit/AuditDrawer'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'

interface AgentPanelProps {
  projectId: string
  chapterRel: string | null
  chapterTitle: string
  editorApi: () => ProseApi | null
  onChapterCheck?: () => void
}

const CHAR_LIMIT = 60000 // 上下文预算：首屏截断，超长走尾部
let ridSeq = 0
const newRid = () => 'r' + Date.now().toString(36) + (ridSeq++).toString(36)

/* ---------- 工具活动卡（meta） ---------- */
function ToolActivity({ tool, args, done, summary }: { tool: string; args?: string; done?: boolean; summary?: string }) {
  return (
    <div className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]', done ? 'border-hair bg-surface' : 'border-hair bg-surface border-accent/30')}>
      {done ? (
        <Check className="h-3 w-3 shrink-0 text-success" />
      ) : (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" />
      )}
      <span className="shrink-0 font-medium text-ink-2">{toolLabel(tool)}</span>
      {args && <span className="flex-1 break-all font-mono text-[10px] leading-4 text-ink-3" title={args}>{args}</span>}
      {done && summary && <span className="shrink-0 whitespace-nowrap text-ink-3">{summary}</span>}
    </div>
  )
}

function toolLabel(tool: string): string {
  const map: Record<string, string> = {
    zj_read_doc: '读文档',
    zj_list_docs: '列文档',
    zj_search: '全文搜索',
    zj_workspace: '看工作区',
    zj_edit_doc: '改正文'
  }
  return map[tool] ?? tool
}

/* ---------- 正文修改卡（edit，IDE 式前后对比） ---------- */
function EditCard({ id, file, edits, state, error, projectId, onChanged }: {
  id: string
  file: string
  edits: EditItem[]
  state?: 'pending' | 'applied' | 'rejected' | 'error'
  error?: string
  projectId: string
  onChanged?: () => void
}) {
  const [busy, setBusy] = useState(false)
  async function accept() {
    if (busy || !edits.length) return
    setBusy(true)
    const r = await window.zhijuan.applyDocEdit(projectId, file, edits)
    setBusy(false)
    if (r.ok) {
      useAgentStore.getState().setEditState(id, 'applied')
      onChanged?.() // 交给父级：刷新章节列表（文件已变）
    } else {
      useAgentStore.getState().setEditState(id, 'error', (r.errors ?? []).join('；'))
    }
  }
  const st = state ?? 'pending'
  return (
    <div className="rounded-xl border border-accent/30 bg-surface p-3">
      <div className="flex items-center gap-1.5">
        <FileText className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{file}</span>
        {st === 'applied' && <span className="rounded-full bg-[#e6f0ee] px-2 py-0.5 text-[10px] text-success">已采纳，已写入</span>}
        {st === 'rejected' && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-ink-3">已拒绝</span>}
        {st === 'error' && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[10px] text-danger">采纳失败</span>}
      </div>
      <div className="mt-2 space-y-2">
        {edits.map((ed, i) => (
          <div key={ed.id ?? i} className="rounded-lg border border-hair bg-surface-2 p-2">
            {ed.reason && <p className="mb-1 text-[11px] text-ink-2">理由：{ed.reason}</p>}
            <div className="whitespace-pre-wrap rounded bg-danger-soft/60 px-2 py-1 text-[11px] leading-5 text-danger">
              <span className="mr-1 select-none">−</span>{ed.before ?? ed.find}
            </div>
            <div className="mt-1 whitespace-pre-wrap rounded bg-accent-soft/60 px-2 py-1 text-[11px] leading-5 text-accent">
              <span className="mr-1 select-none">＋</span>{ed.after ?? ed.replace}
            </div>
          </div>
        ))}
      </div>
      {st === 'pending' && (
        <div className="mt-2.5 flex items-center gap-2">
          <Button size="sm" className="h-7 px-2.5 text-[11px]" onClick={() => void accept()} disabled={busy || !edits.length}>
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
            采纳并写入
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11px]" onClick={() => useAgentStore.getState().setEditState(id, 'rejected')} disabled={busy}>
            <X className="mr-1 h-3 w-3" /> 拒绝
          </Button>
          <span className="text-[10px] text-ink-3">择优后再采纳，采纳即写入 {file}</span>
        </div>
      )}
      {st === 'error' && error && <p className="mt-2 rounded-md bg-danger-soft px-2 py-1 text-[11px] text-danger">{error}</p>}
    </div>
  )
}

/* ---------- 思考过程（可折叠但思考中自动展开并实时可见） ---------- */
function ThinkingBlock({ text, active }: { text: string; active?: boolean }) {
  const [open, setOpen] = useState(!active)
  // 思考中保持展开，让过程实时可见；结束后可手点收起
  useEffect(() => {
    if (active) setOpen(true)
  }, [active])
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="mb-2 group">
      <summary className="flex cursor-pointer select-none items-center gap-1 text-[11px] text-ink-3 hover:text-ink">
        <Brain className="h-3 w-3" />
        <span>{active ? '思考中…' : '思考过程'}</span>
        <ChevronRight className="h-3 w-3 transition-transform" />
      </summary>
      <div className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-surface-2 px-2 py-1.5 text-[11px] leading-5 text-ink-2">
        {text || '（正在思考…）'}
      </div>
    </details>
  )
}

function useSender(props: AgentPanelProps) {
  const setStreaming = useAgentStore((s) => s.setStreaming)
  const streaming = useAgentStore((s) => s.streaming)
  const abortRef = useRef<{ rid: string } | null>(null)

  const send = useCallback(
    async (raw: string, quote: string | null) => {
      const { projectId, chapterRel } = props
      if (streaming || !raw.trim()) return
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
        attachAgentBridge()
        abortRef.current = { rid }
        const history = useAgentStore
          .getState()
          .messages
          .slice(0, -2)
          .filter((m): m is { role: 'user' | 'assistant'; content: string; id: string } => m.role !== 'tool')
          .slice(-20)
          .map((m) => ({ role: m.role, content: m.content }))
        let metaSeq = 0
        const metaStack: string[] = []
        const activeMeta = (): string => metaStack[metaStack.length - 1] ?? ''
        const asstId = useAgentStore.getState().messages.at(-1)?.id ?? ''
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
            else if (e.type === 'think') {
              if (asstId) useAgentStore.getState().appendThinking(asstId, e.text ?? '')
            } else if (e.type === 'meta') {
              const id = rid + '-m' + metaSeq++
              metaStack.push(id)
              useAgentStore.getState().upsertTool({ id, kind: 'meta', tool: e.tool ?? '', toolArgs: e.args, done: false })
            } else if (e.type === 'meta-done') {
              const id = activeMeta()
              if (id) metaStack.pop()
              if (id) useAgentStore.getState().upsertTool({ id, kind: 'meta', tool: e.tool ?? '', done: true, content: e.message ?? '' })
            } else if (e.type === 'edit') {
              if (e.file && e.edits?.length) {
                const eid = rid + '-e' + Date.now().toString(36)
                useAgentStore.getState().upsertTool({ id: eid, kind: 'edit', file: e.file, edits: e.edits, editState: 'pending' })
              }
            } else if (e.type === 'todo') useAgentStore.getState().upsertTool({ id: rid, kind: 'todo', items: e.items ?? [] })
            else if (e.type === 'ask')
              useAgentStore
                .getState()
                .upsertTool({ id: rid + '-a-' + (e.batch ?? ''), kind: 'ask', questions: e.questions ?? [], batch: e.batch ?? '' })
          }
        )
        if (r === 'aborted') patch((useAgentStore.getState().messages.at(-1)?.content ?? '') + '\n\n（已停止）')
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
    if (abortRef.current) cancelAgent(abortRef.current.rid)
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
  const [audit, setAudit] = useState<{ open: boolean; tab: AuditKind }>({ open: false, tab: 'consistency' })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streaming])

  // 上下文用量：当前可见对话的字符规模（上传给引擎的历史 + 本次输入）
  const ctxChars = useMemo(() => {
    const his = messages
      .filter((m) => m.role !== 'tool')
      .slice(-20)
      .reduce((a, m) => a + (m.content?.length ?? 0) + (m.thinking?.length ?? 0), 0)
    return his + input.length
  }, [messages, input])

  function grabQuote() {
    const api = props.editorApi()
    const sel = api?.getSelected()
    if (sel) useAgentStore.getState().setQuote(sel)
  }

  function doSend() {
    const v = input
    setInput('')
    void send(v.trim(), quote)
  }

  const sendBlock: ReactNode = (
    <div className="relative">
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
        className="max-h-40 min-h-[64px] w-full resize-none rounded-xl border border-hair bg-surface pb-9 pl-2.5 pr-11 pt-2 text-[13px] text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {/* 上下文用量（发送按钮左侧） */}
      <div className="pointer-events-none absolute inset-x-2.5 bottom-2 flex items-center gap-1 text-[10px] text-ink-3">
        <span>上下文 {fmtCtx(ctxChars)}</span>
        <span className="opacity-60">/ {fmtCtx(CHAR_LIMIT)}</span>
      </div>
      {/* 悬浮发送按钮 */}
      <div className="absolute bottom-2 right-2">
        {sending ? (
          <button onClick={stop} title="停止生成" className="flex h-7 w-7 items-center justify-center rounded-full border border-hair bg-surface-2 text-ink-2 transition-colors hover:text-danger">
            <Square className="h-3 w-3" />
          </button>
        ) : (
          <button
            onClick={doSend}
            disabled={!input.trim()}
            title="发送"
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full transition-all',
              input.trim() ? 'bg-accent text-accent-ink hover:brightness-95' : 'bg-surface-2 text-ink-3'
            )}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )

  return (
    <>
      <aside className="flex h-full w-80 shrink-0 flex-col border-l border-hair bg-surface-2">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hair px-4">
          <span className="text-sm font-medium text-ink">Agent</span>
          <span className="flex-1" />
          {props.onChapterCheck && (
            <button
              title="本章小环：短巡查 / 分层修订（沿写作线兜底）"
              onClick={props.onChapterCheck}
              disabled={!props.chapterRel}
              className="rounded p-1 text-ink-3 hover:bg-surface hover:text-accent disabled:opacity-40"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            title="一致性巡查：按设定档案检查全卷"
            onClick={() => setAudit({ open: true, tab: 'consistency' })}
            className="rounded p-1 text-ink-3 hover:bg-surface hover:text-accent"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
          </button>
          <button
            title="冷读报告：以读者视角通读全卷"
            onClick={() => setAudit({ open: true, tab: 'review' })}
            className="rounded p-1 text-ink-3 hover:bg-surface hover:text-accent"
          >
            <BookOpenCheck className="h-3.5 w-3.5" />
          </button>
          <button
            title="多视角审视：以三种立场读者各通读一遍"
            onClick={() => setAudit({ open: true, tab: 'perspectives' })}
            className="rounded p-1 text-ink-3 hover:bg-surface hover:text-accent"
          >
            <Users className="h-3.5 w-3.5" />
          </button>
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
              <br />
              <span className="mt-1 inline-block text-[10px] text-ink-3">要改正文时 agent 会直接给出修改方案，采纳即写入，无需复制粘贴。</span>
            </p>
          )}
          {messages.map((m) => {
            if (m.role === 'tool') {
              if (m.kind === 'todo' && m.items) return (
                <div key={m.id} className="w-full">
                  <TodoCard items={m.items} />
                </div>
              )
              if (m.kind === 'ask' && m.questions && m.batch)
                return (
                  <div key={m.id} className="w-full">
                    <AskCard
                      id={m.id}
                      batch={m.batch}
                      questions={m.questions}
                      onAnswered={() => useAgentStore.getState().markAsked(m.id)}
                    />
                  </div>
                )
              if (m.kind === 'edit' && m.file && m.edits)
                return (
                  <div key={m.id} className="w-full">
                    <EditCard
                      id={m.id}
                      file={m.file}
                      edits={m.edits}
                      state={m.editState}
                      error={m.editError}
                      projectId={props.projectId}
                    />
                  </div>
                )
              if (m.kind === 'meta')
                return (
                  <div key={m.id} className="w-full">
                    <ToolActivity tool={m.tool ?? ''} args={m.toolArgs} done={m.done} summary={m.content} />
                  </div>
                )
              return <div key={m.id} className="h-px" />
            }
            return (
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
                  {m.role === 'assistant' && m.thinking && <ThinkingBlock text={m.thinking} active={streaming} />}
                  {m.role === 'assistant' ? (
                    <div className="prose">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || (m.error ? '' : streaming ? '正在生成…' : '')}</ReactMarkdown>
                      {m.error && <span className="text-danger">（{m.content}）</span>}
                    </div>
                  ) : (
                    <span className="whitespace-pre-wrap">{m.content}</span>
                  )}
                </div>
              </div>
            )
          })}
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
          <div className="mt-2">
            {sendBlock}
          </div>
        </div>
      </aside>
      <AuditDrawer
        projectId={props.projectId}
        open={audit.open}
        tab={audit.tab}
        onClose={() => setAudit((a) => ({ ...a, open: false }))}
        onTab={(t) => setAudit((a) => ({ ...a, tab: t }))}
      />
    </>
  )
}

function fmtCtx(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + ' 万字'
  if (n >= 1000) return (n / 1000).toFixed(1) + ' 千字'
  return n + ' 字'
}
