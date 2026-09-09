import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BookOpenCheck, Check, Loader2, RefreshCw, Send, ShieldAlert, Sparkles, X } from 'lucide-react'
import type { AuditItem, AuditKind, AuditResult } from '../../../../shared/types'
import { auditItemToAgentPrompt } from '../../../../shared/auditToAgent'
import { cn } from '../../lib/utils'
import { toast } from '../../components/ui/toast'

const TYPE_TXT: Record<string, string> = {
  'setting-conflict': '设定冲突', timeline: '时间线', foreshadow: '伏笔', 'character-drift': '人物漂移',
  structure: '结构', pacing: '节奏', character: '人物', prose: '行文', setting: '设定', misc: '其他'
}
const K_TITLE: Partial<Record<AuditKind, string>> = {
  consistency: '一致性巡查', review: '冷读报告', perspectives: '多视角审视', presence: '人物在场核查', order: '切片时序核查'
}
const VIEWER_TXT: Record<string, string> = {
  '角色粉': '角色粉视角', '设定党': '设定党视角', '节奏读者': '节奏读者视角'
}
const SEV_CN: Record<AuditItem['severity'], string> = {
  high: 'bg-danger text-white',
  medium: 'bg-warn text-white',
  low: 'bg-ink-3 text-white'
}
interface Props {
  projectId: string
  open: boolean
  tab: AuditKind
  onClose: () => void
  onTab: (t: AuditKind) => void
  /** 「让 agent 改」：把审计条目作为指令发给 agent 区（由父级关闭抽屉并送入对话） */
  onToAgent?: (text: string) => void
  /** agent 区正在生成时禁用「让 agent 改」 */
  toAgentBusy?: boolean
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function AuditDrawer({ projectId, open, tab, onClose, onTab, onToAgent, toAgentBusy }: Props) {
  const [res, setRes] = useState<Partial<Record<AuditKind, AuditResult>>>({})
  const [saved, setSaved] = useState<Partial<Record<AuditKind, string>>>({})
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')
  const [made, setMade] = useState<Set<number>>(new Set())

  const run = useCallback(async () => {
    setRunning(true)
    setErr('')
    try {
      const r = await window.zhijuan.agentAudit(projectId, tab)
      if (r.ok) {
        setRes((m) => ({ ...m, [tab]: r.result }))
        if (r.savedReport) setSaved((m) => ({ ...m, [tab]: r.savedReport }))
        const name = K_TITLE[tab] ?? '检查'
        toast.add({
          kind: 'success',
          title: name + '完成',
          description: r.result.items.length
            ? `共列 ${r.result.items.length} 条${r.savedReport ? '，报告已存档到 大纲/' : '，可逐条转提案'}`
            : '这一遍没有发现问题'
        })
      } else {
        setErr(r.error ?? '巡查失败')
        toast.add({ kind: 'error', title: (K_TITLE[tab] ?? '检查') + '失败', description: r.error ?? '未知原因' })
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e))
      toast.add({ kind: 'error', title: (K_TITLE[tab] ?? '检查') + '失败', description: String(e?.message ?? e) })
    } finally {
      setRunning(false)
    }
  }, [projectId, tab])

  useEffect(() => {
    if (!open) return
    if (running || res[tab] || err) return
    void run()
  }, [open, tab, res, running, err, run])

  const makeProposal = async (idx: number, it: AuditItem) => {
    if (!it.target) return
    try {
      await window.zhijuan.createProposals(projectId, 'agent-chat', '', '', [
        { target: it.target, anchor: '', kind: 'append', before: '', after: it.suggest + '\n\n> 依据：' + it.what, reason: '巡查建议 · ' + (TYPE_TXT[it.type] ?? it.type) }
      ])
      setMade((s) => new Set(s).add(idx))
    } catch {
      /* 忽略单个失败 */
    }
  }

  if (!open) return null
  const cur = res[tab]
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/10" onClick={onClose}>
      <div
        className="flex h-full w-[440px] max-w-[92vw] flex-col border-l border-hair bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-hair px-4 py-3">
          <ShieldAlert className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold">
            {tab === 'consistency' ? '一致性巡查' : tab === 'review' ? '冷读报告' : tab === 'perspectives' ? '多视角审视' : tab === 'presence' ? '人物在场核查' : '切片时序核查'}
          </span>
          <span className="flex-1" />
          <button
            onClick={() => onTab('consistency')}
            className={cn('rounded-md px-2.5 py-1 text-xs', tab === 'consistency' ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-surface-2')}
          >
            巡查
          </button>
          <button
            onClick={() => onTab('review')}
            className={cn('rounded-md px-2.5 py-1 text-xs', tab === 'review' ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-surface-2')}
          >
            冷读
          </button>
          <button
            onClick={() => onTab('perspectives')}
            className={cn('rounded-md px-2.5 py-1 text-xs', tab === 'perspectives' ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-surface-2')}
          >
            视角
          </button>
          <button
            onClick={() => onTab('presence')}
            className={cn('rounded-md px-2.5 py-1 text-xs', tab === 'presence' ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-surface-2')}
          >
            在场
          </button>
          <button
            onClick={() => onTab('order')}
            className={cn('rounded-md px-2.5 py-1 text-xs', tab === 'order' ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-surface-2')}
          >
            时序
          </button>
          <button onClick={onClose} className="text-ink-3 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-hair px-4 py-2 text-[11px] text-ink-3">
          <BookOpenCheck className="h-3.5 w-3.5" />
          {(running || !cur) && !err ? (
            <span className="flex items-center gap-1 text-accent">
              <Loader2 className="h-3 w-3 animate-spin" /> {(tab === 'presence' || tab === 'order') ? '本地规则核查中…' : '写作引擎通读全卷…（几分钟）'}
            </span>
          ) : err ? (
            <span className="text-danger">{err}</span>
          ) : (
            <span>
              {(tab === 'presence' || tab === 'order')
                ? `本地规则核查：共列 ${cur!.items.length} 条（零模型·秒级，可随时重跑）。`
                : `全卷读完，共列 ${cur!.items.length} 条。可逐条转提案再决定是否采纳。`}
            </span>
          )}
          <span className="flex-1" />
          {saved[tab] && !running && !err && (
            <span className="flex shrink-0 items-center gap-1 text-success" title={'已存档：' + saved[tab]}>
              <Check className="h-3 w-3" /> 已存档
            </span>
          )}
          {cur && !running && (
            <button
              onClick={() => { /* 重新跑 */ setRes((m) => ({ ...m, [tab]: undefined })); setErr(''); void run() }}
              className="flex items-center gap-1 text-ink-3 hover:text-ink"
            >
              <RefreshCw className="h-3 w-3" /> 重跑
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!err && cur && cur.summary && (
            <p className="mb-3 rounded-lg border border-hair bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-2">
              {cur.summary}
            </p>
          )}
          {!err && cur && cur.items.length === 0 && (
            <p className="py-10 text-center text-xs text-ink-3">
              <Sparkles className="mx-auto mb-2 h-6 w-6" /> 这一遍没有发现问题。
            </p>
          )}
          {cur?.items.map((it, i) => (
            <div key={i} className="mb-2 rounded-lg border border-hair bg-surface p-3">
              <div className="flex items-center gap-2">
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', SEV_CN[it.severity])}>{it.severity}</span>
                <span className="text-[11px] font-medium text-accent">{TYPE_TXT[it.type] ?? it.type}</span>
                {it.viewer && (
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">{VIEWER_TXT[it.viewer] ?? it.viewer}</span>
                )}
                <span className="flex-1" />
                {onToAgent && (
                  <button
                    onClick={() => onToAgent(auditItemToAgentPrompt(it))}
                    disabled={toAgentBusy}
                    title={toAgentBusy ? 'agent 正在生成，稍候再试' : '把这条审读发现发给 agent 修改正文（走 zj_edit_doc 修改卡）'}
                    className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-warn px-2 py-0.5 text-[11px] text-warn transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Send className="h-3 w-3" /> 让 agent 改
                  </button>
                )}
                {it.target && (
                  made.has(i) ? (
                    <span className="flex items-center gap-1 text-[11px] text-success"><Check className="h-3 w-3" /> 已建提案</span>
                  ) : (
                    <button
                      onClick={() => void makeProposal(i, it)}
                      className="flex items-center gap-1 rounded-md border border-hair px-2 py-0.5 text-[11px] text-ink-2 hover:border-accent hover:text-accent"
                    >
                      <AlertTriangle className="h-3 w-3" /> 转提案
                    </button>
                  )
                )}
              </div>
              <p className="mt-2 text-[11px] text-ink-3">{it.where}</p>
              <p className="mt-1 text-xs text-ink">{it.what}</p>
              <p className="mt-1 text-[11px] text-ink-2">建议：{it.suggest}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
