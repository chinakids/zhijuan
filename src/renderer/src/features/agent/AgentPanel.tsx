import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2, Quote, Paperclip, RotateCcw, Send, ShieldAlert, BookOpenCheck, Check, X, Brain, Square, FileText, ChevronRight, Users, UserCheck, ListOrdered, FileWarning, CircleX } from 'lucide-react'
import type { ProseApi } from '../editor/Prose'
import type { AuditKind, EditItem, ChapterCheckKind, DirectorSheet } from '../../../../shared/types'
import { filterAtCandidates, insertAtMention, parseAtTrigger, type AtCandidate } from '../../../../shared/mention'
import { expandCommand, filterCommandCandidates, insertCommand, matchFixedCommand, parseCommandTrigger, parsePatrolArgs, type ZjCommand } from '../../../../shared/commands'
import { useAgentStore } from './store'
import { sendAgent as harnessSend, cancelAgent, attachAgentBridge } from './harness'
import TodoCard from './TodoCard'
import AskCard from './AskCard'
import AuditDrawer from '../audit/AuditDrawer'
import AtMentionMenu from './AtMentionMenu'
import CommandMenu from './CommandMenu'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'

interface AgentPanelProps {
  projectId: string
  chapterRel: string | null
  chapterTitle: string
  editorApi: () => ProseApi | null
  /** 本章小环入口（tab 可选：chapter=短巡查 / revision=分层修订；缺省短巡查） */
  onChapterCheck?: (tab?: ChapterCheckKind) => void
}

const CHAR_LIMIT = 60000 // 上下文预算：首屏截断，超长走尾部
let ridSeq = 0
const newRid = () => 'r' + Date.now().toString(36) + (ridSeq++).toString(36)

/* ---------- 工具活动卡（meta） ---------- */
function ToolActivity({ tool, args, done, toolOk, summary }: { tool: string; args?: string; done?: boolean; toolOk?: boolean; summary?: string }) {
  const failed = done === true && toolOk === false
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]',
        failed ? 'border-danger/40 bg-surface' : done ? 'border-hair bg-surface' : 'border-accent/30 bg-surface'
      )}
    >
      {failed ? (
        <CircleX className="h-3 w-3 shrink-0 text-danger" />
      ) : done ? (
        <Check className="h-3 w-3 shrink-0 text-success" />
      ) : (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" />
      )}
      <span className={cn('shrink-0 font-medium', failed ? 'text-danger' : 'text-ink-2')}>{toolLabel(tool)}</span>
      {args && <span className="flex-1 break-all font-mono text-[10px] leading-4 text-ink-3" title={args}>{args}</span>}
      {failed && <span className="shrink-0 rounded-full bg-danger-soft px-2 py-0.5 text-[10px] text-danger">失败</span>}
      {done && summary && (
        <span className={cn('shrink-0 whitespace-nowrap', failed ? 'text-danger' : 'text-ink-3')}>{summary}</span>
      )}
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
        {st === 'applied' && <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] text-success">已采纳，已写入</span>}
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
          <Button size="sm" className="h-7 px-2.5 text-[11px] [&_svg]:size-3" onClick={() => void accept()} disabled={busy || !edits.length}>
            {busy ? <Loader2 className="mr-1 animate-spin" /> : <Check className="mr-1" />}
            采纳并写入
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2.5 text-[11px] [&_svg]:size-3" onClick={() => useAgentStore.getState().setEditState(id, 'rejected')} disabled={busy}>
            <X className="mr-1" /> 拒绝
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
        // 必须定位 assistant 气泡：tool 消息（meta/todo/ask/edit 卡）append 在其后，
        // at(-1) 会把 delta/final 打进工具卡 content（回复错位/丢失）
        const last = [...msgs].reverse().find((m) => m.role === 'assistant') ?? msgs[msgs.length - 1]
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
              if (id) useAgentStore.getState().upsertTool({ id, kind: 'meta', tool: e.tool ?? '', done: true, toolOk: e.ok !== false, content: e.message ?? '' })
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
  // 固定逻辑命令（/巡查 /导演）执行中：锁发送防连点
  const [fxBusy, setFxBusy] = useState(false)
  // 取消路径（2026-09-12）：点「停止」作废在途结果（token 递增），并把取消标记发给主进程（跳过落资产）
  const fxTokenRef = useRef(0)
  const fxAidRef = useRef<string | null>(null)

  // ---------- 引擎离线前置拦截（2026-09-12）：发送前懒查一次引擎状态，离线就地提示、不丢输入 ----------
  const [engineOff, setEngineOff] = useState<string | null>(null)
  const checkEngine = useCallback(async (): Promise<boolean> => {
    try {
      const r = await window.zhijuan.agentStatus()
      if (r.online === false) {
        setEngineOff(r.message || '引擎状态异常')
        return false
      }
      setEngineOff(null)
      return true
    } catch {
      setEngineOff('引擎状态查询失败')
      return false
    }
  }, [])

  // ---------- 输入框 @ 引用（GitHub/Slack mention 范式；数据懒加载 + 会话缓存） ----------
  const taRef = useRef<HTMLTextAreaElement>(null)
  const atDataRef = useRef<AtCandidate[]>([])
  const [atTrg, setAtTrg] = useState<{ at: number; length: number; query: string } | null>(null)
  const [atItems, setAtItems] = useState<AtCandidate[]>([])
  const [atActive, setAtActive] = useState(0)
  // ---------- 输入框 / 命令（skill 槽位；与 @ 互斥，取光标前更近的触发字符） ----------
  const [cmdTrg, setCmdTrg] = useState<{ at: number; length: number; query: string } | null>(null)
  const [cmdItems, setCmdItems] = useState<ZjCommand[]>([])
  const [cmdActive, setCmdActive] = useState(0)

  useEffect(() => {
    let alive = true
    void Promise.all([
      window.zhijuan.listDocs(props.projectId, '人物').catch(() => []),
      window.zhijuan.listChapters(props.projectId).catch(() => []),
      window.zhijuan.listDocs(props.projectId, '世界观').catch(() => []),
      window.zhijuan.listDocs(props.projectId, '素材库').catch(() => [])
    ]).then(([chars, chaps, worlds, mats]) => {
      if (!alive) return
      atDataRef.current = [
        ...chars.map((d) => ({ type: '人物' as const, name: d.name, file: `人物/${d.file}` })),
        ...chaps.map((c) => ({
          type: '章节' as const,
          name: (c.fm?.['题名'] ?? '').trim() || c.name,
          file: `正文/${c.file}`
        })),
        ...worlds.map((d) => ({ type: '世界观' as const, name: d.name, file: `世界观/${d.file}` })),
        ...mats.map((d) => ({ type: '素材' as const, name: d.name, file: `素材库/${d.file}` }))
      ]
    })
    return () => {
      alive = false
    }
  }, [props.projectId])

  // @ 与 / 统一触发刷新：同一 caret 下最多一个浮层，激活「更靠近光标」的触发器
  const refreshInput = useCallback((value: string, caret: number) => {
    const atT = parseAtTrigger(value, caret)
    const cmdT = parseCommandTrigger(value, caret)
    const useCmd = cmdT !== null && (atT === null || cmdT.at > atT.at)
    if (useCmd && cmdT) {
      const items = filterCommandCandidates(cmdT.query)
      setAtTrg(null)
      setCmdTrg(cmdT)
      setCmdItems(items)
      setCmdActive((a) => Math.min(a, Math.max(0, items.length - 1)))
      return
    }
    if (atT) {
      const items = filterAtCandidates(atDataRef.current, atT.query)
      setCmdTrg(null)
      setAtTrg(atT)
      setAtItems(items)
      setAtActive((a) => Math.min(a, Math.max(0, items.length - 1)))
      return
    }
    setAtTrg(null)
    setCmdTrg(null)
  }, [])

  const pickAt = useCallback(
    (i?: number) => {
      const cand = atItems[i ?? atActive]
      const trg = atTrg
      if (!cand || !trg) return
      const el = taRef.current
      const cur = el?.value ?? ''
      const r = insertAtMention(cur, trg, cand)
      // 必须强制同步提交：React 18 对受控 textarea 的 value 写回时序不确定（普通 setState 后 DOM 可能仍是旧值），
      // 若 setSelectionRange 跑在旧值 DOM 上，合成 onSelect 会用旧值 refreshAt 把刚关闭的 @ 浮层重新打开
      // （实测踩过：同一 Enter 再次插入产生双块引用）。
      flushSync(() => {
        setAtTrg(null)
        setInput(r.value)
      })
      el?.focus()
      el?.setSelectionRange(r.caret, r.caret)
    },
    [atItems, atActive, atTrg]
  )

  const onAtKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!atTrg) return false
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setAtActive((a) => {
          const n = atItems.length
          if (!n) return 0
          return e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n
        })
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickAt()
        return true
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAtTrg(null)
        return true
      }
      return false
    },
    [atTrg, atItems.length, pickAt]
  )

  const pickCmd = useCallback(
    (i?: number) => {
      const cmd = cmdItems[i ?? cmdActive]
      const trg = cmdTrg
      if (!cmd || !trg) return
      const el = taRef.current
      const cur = el?.value ?? ''
      const r = insertCommand(cur, trg, cmd)
      // 与 pickAt 同口径：flushSync 强制同步提交，setSelectionRange 才不会跑在旧值 DOM 上
      flushSync(() => {
        setCmdTrg(null)
        setInput(r.value)
      })
      el?.focus()
      el?.setSelectionRange(r.caret, r.caret)
    },
    [cmdItems, cmdActive, cmdTrg]
  )

  const onCmdKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!cmdTrg) return false
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCmdActive((a) => {
          const n = cmdItems.length
          if (!n) return 0
          return e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n
        })
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickCmd()
        return true
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setCmdTrg(null)
        return true
      }
      return false
    },
    [cmdTrg, cmdItems.length, pickCmd]
  )

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

  /** 固定逻辑命令（/巡查 /导演）：直连既有入口执行，结果注入对话流（结论落资产），不经模型 */
  async function runFixed(raw: string, cmd: ZjCommand, args: string) {
    const st = useAgentStore.getState()
    st.setQuote(null)
    st.append({ role: 'user', content: raw })
    if (cmd.run === 'chapterCheck') {
      if (!props.chapterRel) {
        st.append({ role: 'assistant', content: '先选中一个章节再 `/巡查`；本章小环是按章检查的。', error: true })
        return
      }
      // 参数结构化（2026-09-12）：枚举校验，识别不了就地提示，不做静默降级
      const mode = parsePatrolArgs(args)
      if (!mode) {
        st.append({
          role: 'assistant',
          content: `「/巡查」参数只认：本章（短巡查）｜修订（分层修订）｜全卷（一致性巡查）；「${args}」无法识别。`,
          error: true
        })
        return
      }
      if (mode === 'full') {
        setAudit({ open: true, tab: 'consistency' })
        st.append({ role: 'assistant', content: '已调起全卷一致性巡查（右侧抽屉），结论可存档到大纲。' })
        return
      }
      props.onChapterCheck?.(mode === 'revision' ? 'revision' : 'chapter')
      st.append({
        role: 'assistant',
        content: mode === 'revision'
          ? '已调起本章小环·分层修订（右侧抽屉），逐层建议可复制回正文。'
          : '已调起本章小环·短巡查（右侧抽屉），每条可转提案。'
      })
      return
    }
    if (cmd.run === 'director') {
      if (!props.chapterRel) {
        st.append({ role: 'assistant', content: '先选中一个章节再 `/导演`；导演板是按章生成的。', error: true })
        return
      }
      const aid = 'fx-' + Date.now().toString(36)
      const token = ++fxTokenRef.current
      fxAidRef.current = aid
      st.upsertTool({ id: aid, kind: 'meta', tool: '章节导演', toolArgs: props.chapterRel, done: false })
      setFxBusy(true)
      try {
        // /导演 参数 = 作者要求（此前被静默丢弃，2026-09-12 接线）；token 供「停止」取消
        const r = await window.zhijuan.agentDirector(props.projectId, props.chapterRel, args || undefined, aid)
        if (fxTokenRef.current !== token) return // 已取消：在途结果作废
        if (r.ok) {
          st.upsertTool({ id: aid, kind: 'meta', tool: '章节导演', done: true, toolOk: true, content: `已写入 ${r.written}` })
          st.append({ role: 'assistant', content: fmtDirectorNote(r.written, r.sheet) })
        } else {
          st.upsertTool({ id: aid, kind: 'meta', tool: '章节导演', done: true, toolOk: false, content: r.error ?? '导演创建失败' })
          st.append({ role: 'assistant', content: '导演创建失败：' + (r.error ?? '未知原因'), error: true })
        }
      } catch (e) {
        if (fxTokenRef.current !== token) return
        const msg = String((e as Error)?.message ?? e)
        st.upsertTool({ id: aid, kind: 'meta', tool: '章节导演', done: true, toolOk: false, content: msg })
        st.append({ role: 'assistant', content: '导演创建失败：' + msg, error: true })
      } finally {
        fxAidRef.current = null
        if (fxTokenRef.current === token) setFxBusy(false)
      }
    }
  }

  /** 取消进行中的固定逻辑子任务（当前＝/导演）：作废在途结果 + 通知主进程跳过落资产 */
  function stopFx() {
    const aid = fxAidRef.current
    fxTokenRef.current++
    fxAidRef.current = null
    setFxBusy(false)
    if (!aid) return
    void window.zhijuan.agentDirectorCancel(aid)
    useAgentStore.getState().upsertTool({
      id: aid,
      kind: 'meta',
      tool: '章节导演',
      done: true,
      toolOk: false,
      content: '已取消（未落盘）'
    })
    useAgentStore.getState().append({
      role: 'assistant',
      content: '已取消导演任务：不再等待生成，导演板不会写入大纲。'
    })
  }

  async function doSend() {
    const v = input
    if (fxBusy || sending || !v.trim()) return
    // 引擎前置检查（2026-09-12）：离线禁止发送并就地提示；查询会顺带尝试拉起引擎，成功即放行
    if (!(await checkEngine())) return
    setInput('')
    // 固定逻辑命令（/巡查 /导演）：直连既有入口执行，不经模型
    const fx = matchFixedCommand(v)
    if (fx) {
      void runFixed(v, fx.cmd, fx.args)
      return
    }
    // 模板命令展开：匹配内置命令名→替换为模板 prompt（未匹配按普通消息原样发送）
    const prompt = expandCommand(v, props.chapterTitle) ?? v
    void send(prompt.trim(), quote)
  }

  const sendBlock: ReactNode = (
    <div className="relative">
      <textarea
        ref={taRef}
        value={input}
        onChange={(e) => {
          const v = e.target.value
          setInput(v)
          const composing = (e.nativeEvent as { isComposing?: boolean }).isComposing
          if (!composing) refreshInput(v, e.target.selectionStart ?? v.length)
        }}
        onSelect={(e) => {
          const el = e.currentTarget
          refreshInput(el.value, el.selectionStart ?? 0)
        }}
        onCompositionEnd={(e) => {
          const el = e.currentTarget
          refreshInput(el.value, el.selectionStart ?? el.value.length)
        }}
        onKeyDown={(e) => {
          if (onAtKeyDown(e)) return
          if (onCmdKeyDown(e)) return
          if (e.key === 'Enter' && !e.shiftKey) {
            // IME 选字回车（isComposing）只确认候选，不发送
            if ((e.nativeEvent as { isComposing?: boolean }).isComposing) return
            e.preventDefault()
            doSend()
          }
        }}
        placeholder="让 agent 续写 / 改写 / 查设定…（Enter 发送，@ 引用，/ 命令）"
        className="max-h-40 min-h-[64px] w-full resize-none rounded-xl border border-hair bg-surface pb-9 pl-2.5 pr-11 pt-2 text-[13px] text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {/* @ 引用浮层（GitHub/Slack mention 范式：固定在输入框上方） */}
      {atTrg && (
        <AtMentionMenu items={atItems} active={atActive} onPick={(i) => pickAt(i)} onActiveChange={setAtActive} />
      )}
      {/* / 命令浮层（与 @ 互斥，同一位置） */}
      {cmdTrg && (
        <CommandMenu items={cmdItems} active={cmdActive} onPick={(i) => pickCmd(i)} onActiveChange={setCmdActive} />
      )}
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
        ) : fxBusy ? (
          <button
            onClick={stopFx}
            title="停止导演任务（结果不落盘）"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-hair bg-surface-2 text-ink-2 transition-colors hover:text-danger"
          >
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
              onClick={() => props.onChapterCheck?.()}
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
          <button
            title="人物在场与称谓核查：约定头「涉及人物」vs 正文本名/登记别名（本地规则·秒级·零模型）"
            onClick={() => setAudit({ open: true, tab: 'presence' })}
            className="rounded p-1 text-ink-3 hover:bg-surface hover:text-accent"
          >
            <UserCheck className="h-3.5 w-3.5" />
          </button>
          <button
            title="切片时序核查：章号结构 + 切片顺序（本地规则·秒级·零模型）"
            onClick={() => setAudit({ open: true, tab: 'order' })}
            className="rounded p-1 text-ink-3 hover:bg-surface hover:text-accent"
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </button>
          <button
            title="人物档案腐坏核查：别名声明但全卷正文从未出现（本地规则·秒级·零模型）"
            onClick={() => setAudit({ open: true, tab: 'unused' })}
            className="rounded p-1 text-ink-3 hover:bg-surface hover:text-accent"
          >
            <FileWarning className="h-3.5 w-3.5" />
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
                    <ToolActivity tool={m.tool ?? ''} args={m.toolArgs} done={m.done} toolOk={m.toolOk} summary={m.content} />
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
              <Paperclip />
              <span className="ml-1">引用选中</span>
            </Button>
          </div>
          <div className="mt-2">
            {engineOff && (
              <div className="mb-2 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-2.5 py-2">
                <CircleX className="mt-0.5 h-3 w-3 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-danger">引擎离线，无法发送</p>
                  <p className="break-all text-[10px] leading-4 text-ink-2" title={engineOff}>{engineOff}</p>
                </div>
                <button
                  onClick={() => void checkEngine()}
                  title="重新探测引擎状态"
                  className="shrink-0 whitespace-nowrap rounded-full border border-hair bg-surface px-2 py-0.5 text-[10px] text-ink-2 hover:text-ink"
                >
                  重试
                </button>
              </div>
            )}
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
        onToAgent={(text) => {
          setAudit((a) => ({ ...a, open: false }))
          void send(text, null)
        }}
        toAgentBusy={sending}
      />
    </>
  )
}

function fmtCtx(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1) + ' 万字'
  if (n >= 1000) return (n / 1000).toFixed(1) + ' 千字'
  return n + ' 字'
}

/** /导演 结果注入对话流的摘要（完整导演板落 大纲/<章>_导演.md，这里给要点与指路） */
function fmtDirectorNote(written: string, s: DirectorSheet): string {
  const axes = s.axes.map((a) => `${a.character}（${a.level}）${a.line ? '：' + a.line : ''}`).join('；')
  return [
    `导演板已写入 \`${written}\`，大纲区可直接打开。`,
    '',
    `**本章任务**：${s.premise}`,
    `**情绪弧**：${s.arcs.length} 段（${s.arcs.map((a) => a.task).join(' → ')}），波峰在第 ${s.climax?.at ?? '-'} 段：${s.climax?.idea ?? ''}`,
    `**行为轴**：${axes || '—'}`,
    `**红线** ${s.redlines.length} 条 · **钩子** ${s.hooks.length} 条（要点见导演板）`,
    '',
    '要我按这张板起草本章，直接说「按导演板写」。'
  ].join('\n')
}
