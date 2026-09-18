import { useMemo, useRef, useState } from 'react'
import { Check, X, FileText, GitCompare, Inbox, ChevronDown, Trash2, RefreshCw } from 'lucide-react'
import type { Proposal, SyncIssue } from '../../../../shared/types'
import { Button } from '../../components/ui/button'
import { ScrollArea } from '../../components/ui/scroll-area'
import { toast, type ToastKind, type ToastAction } from '../../store/toasts'
import { cn } from '../../lib/utils'
import { useModalA11y } from '../../lib/useModalA11y'
import { syncAfterChapterEdit } from '../sync/editSync'
import { formatGuardIssuesText } from '../sync/guardText'
import { isUnfiledIssue } from '../sync/guardCreate'
import { bulkQuickCreate } from '../sync/guardBulk'
import { describeSyncEvidence } from '../../../../shared/syncEvidence'
import { useProposalStore } from '../../store/proposals'
import { isChapterTarget } from '../../../../shared/editSyncGate'
import type { SliceSyncResult } from '../sync/sliceSync'

interface Props {
  projectId: string
  list: Proposal[]
  onChanged: () => void
  onClose: () => void
}

const STATUS: Record<string, { text: string; cls: string }> = {
  pending: { text: '待确认', cls: 'bg-warn-soft text-warn' },
  accepted: { text: '已接受', cls: 'bg-success-soft text-success' },
  rejected: { text: '已拒绝', cls: 'bg-danger-soft text-danger' },
  stale: { text: '已过期', cls: 'bg-surface-2 text-ink-3' }
}

/** toast 同步结果的描述 + 可处置的未建档条目（批注接受入口：守卫明细在 toast 就地可处置，与四入口 GuardIssuesNote 同能力）
 * 明细渐进披露（2026-09-18）：摘要「（拦截 N 条）」常显，完整逐行明细走 detail（toast 内「查看明细」一层展开）——
 * 与四入口 GuardIssuesNote「摘要常显、明细按需一层展开」同构；批量建档 action 仍留在首层（NN/g「frequently need up front」）。 */
function describeChapterSync(s: SliceSyncResult | 'throttled' | 'skipped'): { ok: boolean; kind: ToastKind; desc: string; detail?: string; unfiled: SyncIssue[] } | null {
  if (s === 'throttled' || s === 'skipped') return null
  const unfiled = (s.issues ?? []).filter(isUnfiledIssue)
  const guardText = formatGuardIssuesText(s.issues)
  const guardNote = guardText ? `（拦截 ${s.issues!.length} 条）` : ''
  const detail = guardText || undefined
  if (s.ok) {
    return {
      ok: true,
      kind: 'success',
      desc: s.items > 0 ? `正文已改写，切片同步到 ${s.items} 条提案待确认${guardNote}` : `正文已改写，切片同步无设定变化${describeSyncEvidence(s.evidence)}${guardNote}`,
      detail,
      unfiled
    }
  }
  return { ok: false, kind: 'warning', desc: s.error ?? '切片同步失败', unfiled: [] }
}

/** toast 内「为 N 名人物建档案」一键批量建档：写前查存在不覆盖（与四入口同一实现），完成后更新同一条 toast */
async function createMissingOnToast(tid: number, projectId: string, issues: SyncIssue[]) {
  try {
    const { created, skipped } = await bulkQuickCreate(projectId, issues)
    const parts: string[] = []
    if (created.length) parts.push(`已为 ${created.length} 名人物建档案`)
    if (skipped.length) parts.push(`${skipped.length} 名已有档案未改动`)
    // 摘除 action → 恢复类型默认自动消失（常驻到处置完成，符合带 action 常驻口径）；detail 显式清除（update 浅合并）
    toast.update(tid, { kind: 'success', title: '已建档案', description: `${parts.join('，')}；下次保存同步不再拦截`, detail: undefined, action: null })
  } catch (e) {
    toast.update(tid, {
      kind: 'warning',
      title: '建档案失败',
      description: String((e as Error).message ?? e),
      action: { label: '重试建档案', onClick: () => void createMissingOnToast(tid, projectId, issues) }
    })
  }
}

/** 同步成功且有未建档拦截 → 挂「为 N 名人物建档案」动作按钮（toast 本身已逐行展示明细，作者可先看清是谁） */
function guardAction(tid: number, projectId: string, d: { ok: boolean; unfiled: SyncIssue[] }): ToastAction | null {
  if (d.ok && d.unfiled.length > 0) {
    return {
      label: `为 ${d.unfiled.length} 名人物建档案`,
      onClick: () => void createMissingOnToast(tid, projectId, d.unfiled)
    }
  }
  return null
}

/** 重试：更新同一条 toast（loading → 结果），失败仍可再重试 */
function retryChapterSync(projectId: string, target: string) {
  const tid = toast.add({ kind: 'loading', title: '切片同步重试中…', duration: 0 })
  void syncAfterChapterEdit(projectId, target)
    .then((s) => {
      const d = describeChapterSync(s)
      if (!d) {
        toast.dismiss(tid)
        return
      }
      toast.update(tid, {
        kind: d.kind,
        title: '切片同步',
        description: d.desc,
        detail: d.detail,
        action: guardAction(tid, projectId, d) ?? (d.ok ? null : { label: '重试同步', onClick: () => retryChapterSync(projectId, target) })
      })
    })
    .catch(() => {
      toast.update(tid, {
        kind: 'warning',
        title: '切片同步',
        description: '同步失败',
        action: { label: '重试同步', onClick: () => retryChapterSync(projectId, target) }
      })
    })
}

/** 正文类提案（annotation-sync 批注改写）接受后：与「保存/分幕采纳/EditCard 采纳」同口径触发切片同步（收口+节流），结果 toast */
function toastAfterChapterApply(projectId: string, target: string) {
  void syncAfterChapterEdit(projectId, target)
    .then((s) => {
      const d = describeChapterSync(s)
      if (!d) return
      const tid = toast.add({ kind: d.kind, title: '切片同步', description: d.desc, detail: d.detail })
      const act = guardAction(tid, projectId, d) ?? (!d.ok ? { label: '重试同步', onClick: () => retryChapterSync(projectId, target) } : null)
      if (act) toast.update(tid, { action: act })
    })
    .catch(() => {
      toast.add({
        kind: 'warning',
        title: '切片同步',
        description: '同步失败',
        action: { label: '重试同步', onClick: () => retryChapterSync(projectId, target) }
      })
    })
}

function ItemCard({ p, projectId, onChanged, err, onErr }: { p: Proposal; projectId: string; onChanged: () => void; err?: string; onErr: (id: string, msg: string) => void }) {
  const it = p.items[0]
  const [showDiff, setShowDiff] = useState(false)
  const [busy, setBusy] = useState(false)
  async function doApply() {
    setBusy(true)
    onErr(p.id, '')
    try {
      const r = await window.zhijuan.applyProposal(projectId, p.id)
      if (!r.ok || r.errors?.length) {
        // 失败原因挂 store 级 errMap（proposalId→err）：提案 status→rejected 后从 pending 组
        // 移入 done 组，ItemCard 会卸载重挂（两个 map 调用不共享 fiber），组件本地 state
        // 在换组后归零——15:45 轮实锤「err 永不进 DOM」的根因；挂 store 级才换组后仍可见，
        // 且关抽屉重开/跨页保留（2026-09-17；成功/拒绝/过期/列表消失时清除）。
        // toast 仍作兜底（抽屉关闭/长流程中也可见）。
        // 2026-09-16：IO/系统失败（retryable）保持 pending 可重试，文案改指路「可直接重试」而非核对原文
        const msg = (r.errors?.join('；') || '写入失败') + (r.retryable ? '（系统写入失败，可直接重试）' : '（请先核对原文；如需继续请重新扫描批注或再次保存）')
        onErr(p.id, msg)
        toast.add({ kind: 'warning', title: '提案未应用', description: msg })
      } else {
        // 正文为源、设定为流：正文类提案（批注改写）接受后触发切片同步（跳过则刷新列表）
        const t = p.items[0]?.target ?? ''
        if (isChapterTarget(t) && t) toastAfterChapterApply(projectId, t)
      }
    } catch (e) {
      onErr(p.id, String((e as Error).message || e))
    } finally {
      setBusy(false)
    }
    onChanged()
  }
  async function doReject() {
    await window.zhijuan.rejectProposal(projectId, p.id)
    onErr(p.id, '')
    onChanged()
  }
  async function doDiscard() {
    await window.zhijuan.discardProposal(projectId, p.id)
    onErr(p.id, '')
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
      {(p.chapter || p.slice) && (
        <p className="mt-1 flex items-center gap-2 text-[10px] text-ink-3">
          {p.chapter && <span className="truncate">章：{p.chapter}</span>}
          {p.slice && <span className="truncate">切片：{p.slice}</span>}
        </p>
      )}
      <button onClick={() => setShowDiff((v) => !v)} className="mt-2 flex items-center gap-1 text-[11px] text-ink-3 hover:text-ink">
        <GitCompare className="h-3 w-3" /> 前后对照
        <ChevronDown className={cn('h-3 w-3 transition-transform motion-reduce:transition-none', showDiff && 'rotate-180')} />
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
        <Button size="sm" className="h-7 shrink-0 whitespace-nowrap px-2 text-[11px] [&_svg]:size-3" onClick={() => void doApply()} disabled={busy || p.status !== 'pending'}>
          <Check className="mr-1" /> 接受
        </Button>
        <Button size="sm" variant="outline" className="h-7 shrink-0 whitespace-nowrap px-2 text-[11px] [&_svg]:size-3" onClick={() => void doReject()} disabled={p.status !== 'pending'}>
          <X className="mr-1" /> 拒绝
        </Button>
        {p.status === 'stale' && (
          <Button size="sm" variant="ghost" className="h-7 shrink-0 whitespace-nowrap px-2 text-[11px] text-danger hover:bg-danger-soft hover:text-danger [&_svg]:size-3" onClick={() => void doDiscard()} title="清除这条过期提案">
            <Trash2 className="mr-1" /> 清除
          </Button>
        )}
        <span className="text-[10px] text-ink-3">来自：{p.source === 'slice-sync' ? '正文保存同步' : p.source === 'annotation-sync' ? '批注同步' : 'agent'}</span>
      </div>
      {err && <p className="mt-2 rounded-md bg-danger-soft px-2 py-1 text-[11px] text-danger">{err}</p>}
    </div>
  )
}

export default function ProposalDrawer({ projectId, list, onChanged, onClose }: Props) {
  // 提案级错误（proposalId→err）：ItemCard 在 pending→done 换组时会卸载重挂，组件本地错误态
  // 会丢失（15:45 轮实锤）——挂抽屉级 Map，换组后卡片内红字仍可见；2026-09-17 再迁 store：
  // IO 失败保持 pending 后失败卡是「可恢复资源」，关抽屉重开红字不能丢（只靠 toast 记忆作者
  // 无从知道「这条为什么还在待确认」）——挂 useProposalStore，跨开合/跨页保留，
  // 成功/拒绝/过期/提案从列表消失时清除（refresh 收敛）。
  const errMap = useProposalStore((s) => s.errMap)
  const reportErr = useProposalStore((s) => s.setErr)
  const pending = useMemo(() => list.filter((p) => p.status === 'pending'), [list])
  const done = useMemo(() => list.filter((p) => p.status === 'accepted' || p.status === 'rejected'), [list])
  const stale = useMemo(() => list.filter((p) => p.status === 'stale'), [list])
  // 模态无障碍：焦点圈闭 / Esc 关闭 / 滚动锁 / 关闭回焦（Apple HIG Keyboards；条件渲染组件 open 恒真）
  const panelRef = useRef<HTMLDivElement>(null)
  useModalA11y(true, panelRef, onClose)
  const [allBusy, setAllBusy] = useState(false)
  async function allApply() {
    // 批量动作失败可见性（2026-09-16 00:45 轮；21:45 观察③）：旧实现 `if (r.ok)` 静默吞失败——
    // 与单卡 doApply（toast 兜底 + errMap 卡片红字）不对齐。SAP Fiori「Processing Multiple Items」：
    // 部分处理 = 汇总（成功 N / 失败 M + 首条原因）+ 逐条明细；NN/g：错误须可诊断、可恢复。
    setAllBusy(true)
    const targets = new Set<string>()
    const fails: { id: string; msg: string }[] = []
    try {
      for (const p of pending) {
        let r: { ok: boolean; errors: string[]; retryable?: boolean }
        try {
          r = await window.zhijuan.applyProposal(projectId, p.id)
        } catch (e) {
          r = { ok: false, errors: [String((e as Error).message || e)] }
        }
        if (r.ok) {
          reportErr(p.id, '')
          const t = p.items[0]?.target ?? ''
          if (isChapterTarget(t) && t) targets.add(t)
        } else {
          const msg = (r.errors?.join('；') || '写入失败') + (r.retryable ? '（系统写入失败，可直接重试）' : '（请先核对原文；如需继续请重新扫描批注或再次保存）')
          fails.push({ id: p.id, msg })
          reportErr(p.id, msg)
        }
      }
    } finally {
      setAllBusy(false)
    }
    onChanged()
    if (fails.length > 0) {
      const rest = pending.length - fails.length
      // 与单卡同款文案（含指路）；逐条 errMap 已让失败卡换组后红字仍可见（同 doApply 机制）
      toast.add({
        kind: 'warning',
        title: `${fails.length} 条提案未应用`,
        description: `${rest > 0 ? `其余 ${rest} 条已接受，` : '全部未应用，'}${fails[0].msg}`
      })
    }
    for (const t of targets) toastAfterChapterApply(projectId, t)
  }
  async function doScan() {
    try {
      const r = await window.zhijuan.scanAnnotations(projectId)
      if (r.generated > 0) toast.add({ kind: 'success', title: '批注定时优化', description: r.note })
      else if (r.found > 0) toast.add({ kind: 'warning', title: '批注定时优化', description: r.note })
      else toast.add({ kind: 'info', title: '批注定时优化', description: r.note })
    } catch (e) {
      toast.add({ kind: 'error', title: '批注扫描失败', description: String((e as Error).message ?? e) })
    }
    onChanged()
  }
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 animate-in fade-in">
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-label="提案" className="flex h-full w-[460px] flex-col border-l border-hair bg-paper shadow-[var(--shadow)] animate-in fade-in slide-in-from-right-3">
        <div className="flex h-12 shrink-0 items-center border-b border-hair px-4">
          <span className="text-sm font-medium">提案</span>
          <span className="ml-2 text-[11px] text-ink-3">切片同步与批注优化都会在这里提出修改</span>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-[11px] [&_svg]:size-3" onClick={() => void doScan()}>
            <RefreshCw /> 扫描批注
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={onClose}>收起</Button>
        </div>
        <ScrollArea className="min-h-0 flex-1 px-3 py-3">
          {pending.length > 0 && (
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-medium text-warn">待确认 {pending.length}</span>
              <span className="flex-1" />
              <Button size="sm" className="h-7 px-2 text-[11px]" onClick={() => void allApply()} disabled={allBusy}>全部接受</Button>
            </div>
          )}
          {pending.length === 0 && done.length === 0 && stale.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-ink-3">
              <Inbox className="h-6 w-6" />
              <p className="text-xs">还没有提案。保存正文后，切片同步会在这里提出设定更新。</p>
            </div>
          )}
          {pending.map((p) => <ItemCard key={p.id} p={p} projectId={projectId} onChanged={onChanged} err={errMap[p.id]} onErr={reportErr} />)}
          {done.map((p) => <ItemCard key={p.id} p={p} projectId={projectId} onChanged={onChanged} err={errMap[p.id]} onErr={reportErr} />)}
          {stale.length > 0 && (
            <div className="mt-3 border-t border-hair pt-2">
              <p className="mb-2 text-[11px] text-ink-3">已过期 {stale.length} 条（章节被删除或再次保存，不可接受，可查看后清除）</p>
              {stale.map((p) => <ItemCard key={p.id} p={p} projectId={projectId} onChanged={onChanged} err={errMap[p.id]} onErr={reportErr} />)}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
