import { useMemo, useState } from 'react'
import { Check, X, FileText, GitCompare, Inbox, ChevronDown } from 'lucide-react'
import type { Proposal } from '../../../../shared/types'
import { Button } from '../../components/ui/button'
import { ScrollArea } from '../../components/ui/scroll-area'
import { cn } from '../../lib/utils'

interface Props {
  projectId: string
  list: Proposal[]
  onChanged: () => void
  onClose: () => void
}

const STATUS: Record<string, { text: string; cls: string }> = {
  pending: { text: '待确认', cls: 'bg-warn-soft text-warn' },
  accepted: { text: '已接受', cls: 'bg-[#e6f0ee] text-success' },
  rejected: { text: '已拒绝', cls: 'bg-danger-soft text-danger' },
  stale: { text: '已过期', cls: 'bg-surface-2 text-ink-3' }
}

function ItemCard({ p, projectId, onChanged }: { p: Proposal; projectId: string; onChanged: () => void }) {
  const it = p.items[0]
  const [showDiff, setShowDiff] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function doApply() {
    setBusy(true)
    setErr('')
    try {
      const r = await window.zhijuan.applyProposal(projectId, p.id)
      if (!r.ok || r.errors?.length) setErr((r.errors?.join('；') || '写入失败') + '（可重试或改原地后再接受）')
    } catch (e) {
      setErr(String((e as Error).message || e))
    } finally {
      setBusy(false)
    }
    onChanged()
  }
  async function doReject() {
    await window.zhijuan.rejectProposal(projectId, p.id)
    onChanged()
  }
  const st = STATUS[p.status] ?? STATUS.pending
  return (
    <div className="mb-2 rounded-xl border border-hair bg-surface p-3">
      <div className="flex items-center gap-2">
        <FileText className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="truncate text-sm font-medium">{it?.target}</span>
        <span className="flex-1" />
        <span className={cn('rounded-full px-2 py-0.5 text-[10px]', st.cls)}>{st.text}</span>
      </div>
      <p className="mt-1.5 text-xs text-ink-2">理由：{it?.reason}</p>
      <button onClick={() => setShowDiff((v) => !v)} className="mt-2 flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink">
        <GitCompare className="h-3 w-3" /> 前后对照
        <ChevronDown className={cn('h-3 w-3 transition-transform', showDiff && 'rotate-180')} />
      </button>
      {showDiff && (
        <div className="mt-2 grid gap-2 text-[11px]">
          <div className="rounded-lg bg-surface-2 p-2">
            <div className="mb-1 font-medium text-ink-3">原状（摘要）</div>
            <div className="line-clamp-3 whitespace-pre-wrap text-ink-2">{it?.before || '（新小节）'}</div>
          </div>
          <div className="rounded-lg border border-accent/30 bg-accent-soft/50 p-2">
            <div className="mb-1 font-medium text-accent">将写入</div>
            <div className="whitespace-pre-wrap text-ink">{it?.after}</div>
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" className="h-7 px-2 text-[11px]" onClick={() => void doApply()} disabled={busy || p.status !== 'pending'}>
          <Check className="mr-1 h-3 w-3" /> 接受
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => void doReject()} disabled={p.status !== 'pending'}>
          <X className="mr-1 h-3 w-3" /> 拒绝
        </Button>
        <span className="text-[10px] text-ink-3">来自：{p.source === 'slice-sync' ? '正文保存同步' : 'agent'}</span>
      </div>
      {err && <p className="mt-2 rounded-md bg-danger-soft px-2 py-1 text-[11px] text-danger">{err}</p>}
    </div>
  )
}

export default function ProposalDrawer({ projectId, list, onChanged, onClose }: Props) {
  const pending = useMemo(() => list.filter((p) => p.status === 'pending'), [list])
  const done = useMemo(() => list.filter((p) => p.status === 'accepted' || p.status === 'rejected'), [list])
  const stale = useMemo(() => list.filter((p) => p.status === 'stale'), [list])
  async function allApply() {
    for (const p of pending) await window.zhijuan.applyProposal(projectId, p.id)
    onChanged()
  }
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20">
      <div className="flex h-full w-[460px] flex-col border-l border-hair bg-paper shadow-[var(--shadow)]">
        <div className="flex h-12 shrink-0 items-center border-b border-hair px-4">
          <span className="text-sm font-medium">提案（切片同步）</span>
          <span className="ml-2 text-[11px] text-ink-3">正文保存时自动判别，接受才写入设定</span>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={onClose}>收起</Button>
        </div>
        <ScrollArea className="min-h-0 flex-1 px-3 py-3">
          {pending.length > 0 && (
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium text-warn">待确认 {pending.length}</span>
              <span className="flex-1" />
              <Button size="sm" className="h-7 px-2 text-[11px]" onClick={() => void allApply()}>全部接受</Button>
            </div>
          )}
          {pending.length === 0 && done.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-ink-3">
              <Inbox className="h-6 w-6" />
              <p className="text-xs">还没有提案。保存正文后，切片同步会在这里提出设定更新。</p>
            </div>
          )}
          {pending.map((p) => <ItemCard key={p.id} p={p} projectId={projectId} onChanged={onChanged} />)}
          {done.map((p) => <ItemCard key={p.id} p={p} projectId={projectId} onChanged={onChanged} />)}
          {stale.length > 0 && <div className="mt-3 border-t border-hair pt-2 text-[11px] text-ink-3">另有 {stale.length} 条因章节再次保存而过期。</div>}
        </ScrollArea>
      </div>
    </div>
  )
}
