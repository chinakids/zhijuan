import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowRightLeft, Check, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import type { TriageItem, TriageResult } from '../../../../shared/types'
import { cn } from '../../lib/utils'

const VERDICT_CN: Record<TriageItem['verdict'], string> = {
  promote: 'bg-success text-white',
  reference: 'bg-accent-soft text-accent',
  skip: 'bg-ink-3 text-white'
}
const VERDICT_TXT: Record<TriageItem['verdict'], string> = {
  promote: '可入档',
  reference: '可借鉴',
  skip: '暂不用'
}

interface Props {
  projectId: string
  open: boolean
  onClose: () => void
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 素材→设定升格：把素材库按语境归类，逐条判「可入档与否」，可转提案走安全写入。 */
export default function TriageDrawer({ projectId, open, onClose }: Props) {
  const [res, setRes] = useState<TriageResult | null>(null)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')
  const [made, setMade] = useState<Set<number>>(new Set())

  const run = useCallback(async () => {
    setRunning(true)
    setErr('')
    try {
      const r = await window.zhijuan.agentTriage(projectId)
      if (r.ok) setRes(r.result)
      else setErr(r.error ?? '升格检查失败')
    } catch (e: any) {
      setErr(String(e?.message ?? e))
    } finally {
      setRunning(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!open) return
    if (running || res || err) return
    void run()
  }, [open, running, res, err, run])

  const makeProposal = async (i: number, it: TriageItem) => {
    if (!it.target) return
    try {
      await window.zhijuan.createProposals(projectId, 'agent-chat', '', '', [
        {
          target: it.target,
          anchor: '',
          kind: 'append',
          before: '',
          after: `### 素材升格 · ${it.name}\n\n${it.suggestion}\n\n> 依据素材：${it.file}`,
          reason: '素材升格 · ' + (VERDICT_TXT[it.verdict] ?? it.verdict)
        }
      ])
      setMade((s) => new Set(s).add(i))
    } catch {
      /* 忽略单个失败 */
    }
  }

  if (!open) return null
  const promoteCount = res?.items.filter((x) => x.verdict === 'promote').length ?? 0

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/10" onClick={onClose}>
      <div
        className="flex h-full w-[440px] max-w-[92vw] flex-col border-l border-hair bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-hair px-4 py-3">
          <ArrowRightLeft className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold">素材 → 设定升格</span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-ink-3 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-hair px-4 py-2 text-[11px] text-ink-3">
          {running || (!res && !err) ? (
            <span className="flex items-center gap-1 text-accent"><Loader2 className="h-3 w-3 animate-spin" /> 写作引擎读素材库并归类…（一两分钟）</span>
          ) : err ? (
            <span className="text-danger">{err}</span>
          ) : (
            <span>共 {res!.items.length} 条素材归类完成，{promoteCount} 条建议直接入档。可逐条转提案再决定。</span>
          )}
          <span className="flex-1" />
          {res && !running && (
            <button
              onClick={() => {
                setRes(null)
                setErr('')
                void run()
              }}
              className="text-ink-3 hover:text-ink"
            >
              <RefreshCw className="h-3 w-3" /> 重跑
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!err && res && res.summary && (
            <p className="mb-3 rounded-lg border border-hair bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-2">{res.summary}</p>
          )}
          {!err && res && res.items.length === 0 && (
            <p className="py-10 text-center text-xs text-ink-3">
              <Sparkles className="mx-auto mb-2 h-6 w-6" /> 素材库还是空的，先去采集或建素材卡。
            </p>
          )}
          {res?.items.map((it, i) => (
            <div key={i} className="mb-2 rounded-lg border border-hair bg-surface p-3">
              <div className="flex items-center gap-2">
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', VERDICT_CN[it.verdict])}>{VERDICT_TXT[it.verdict]}</span>
                <span className="text-[11px] font-medium text-accent">{it.category}</span>
                <span className="flex-1" />
                {it.target &&
                  (made.has(i) ? (
                    <span className="flex items-center gap-1 text-[11px] text-success"><Check className="h-3 w-3" /> 已建提案</span>
                  ) : (
                    <button
                      onClick={() => void makeProposal(i, it)}
                      className="flex items-center gap-1 rounded-md border border-hair px-2 py-0.5 text-[11px] text-ink-2 hover:border-accent hover:text-accent"
                    >
                      <AlertTriangle className="h-3 w-3" /> 升格为提案
                    </button>
                  ))}
              </div>
              <p className="mt-2 text-xs font-medium text-ink">{it.name}</p>
              <p className="mt-1 text-[11px] text-ink-2">内容：{it.what}</p>
              <p className="mt-1 text-[11px] text-ink-3">去向：{it.target ? `${it.target}（建议入档）` : `保留在素材库（${it.suggestion}）`}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
