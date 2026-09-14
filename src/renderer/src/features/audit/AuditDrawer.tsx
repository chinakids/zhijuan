import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, BookOpenCheck, Check, ChevronLeft, GitCompare, RefreshCw, Send, ShieldAlert, Sparkles, X } from 'lucide-react'
import LoadingIndicator from '../../components/LoadingIndicator'
import type { AuditItem, AuditKind, AuditResult } from '../../../../shared/types'
import { auditItemToAgentPrompt } from '../../../../shared/auditToAgent'
import { parseAuditMarkdown } from '../../../../shared/auditDoc'
import { diffAuditReports, type AuditDiffResult } from '../../../../shared/auditDiff'
import { cn } from '../../lib/utils'
import { useModalA11y } from '../../lib/useModalA11y'
import { toast } from '../../components/ui/toast'

const TYPE_TXT: Record<string, string> = {
  'setting-conflict': '设定冲突', timeline: '时间线', foreshadow: '伏笔', 'character-drift': '人物漂移',
  structure: '结构', pacing: '节奏', character: '人物', prose: '行文', setting: '设定', misc: '其他'
}
const K_TITLE: Partial<Record<AuditKind, string>> = {
  consistency: '一致性巡查', review: '冷读报告', perspectives: '多视角审视', presence: '人物在场核查', order: '切片时序核查', unused: '人物档案腐坏核查', actgaps: '正文缺段核查', sliceord: '档案切片核查', nameform: '称谓发现核查'
}
/** 本地规则检查（零模型·秒级）：不走写作引擎、不落盘、高频重跑（与主进程 runAudit 分支同口径） */
const LOCAL_KINDS: AuditKind[] = ['presence', 'order', 'unused', 'actgaps', 'sliceord', 'nameform']
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

/** 落盘类检查（重跑会把上一版留进 .zhijuan/history/）——只有它们才有「与上次对比」 */
const SAVED_KINDS: AuditKind[] = ['consistency', 'review', 'perspectives']
/** 版本文件名 yyyyMMdd-HHmmss-SSS → 2026-09-12 15:01:02（与 HistoryDrawer 同口径） */
function fmtTime(name: string): string {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/)
  if (!m) return name.replace(/\.md$/, '')
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`
}

export default function AuditDrawer({ projectId, open, tab, onClose, onTab, onToAgent, toAgentBusy }: Props) {
  const [res, setRes] = useState<Partial<Record<AuditKind, AuditResult>>>({})
  const [saved, setSaved] = useState<Partial<Record<AuditKind, string>>>({})
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')
  const [made, setMade] = useState<Set<number>>(new Set())
  // 对比视图「转提案」已建状态（key=分组字母+序号，如 'a0'/'s1'；候选 1③ 2026-09-13）
  const [madeDiff, setMadeDiff] = useState<Set<string>>(new Set())
  // 「与上次对比」三期（2026-09-12）：语义三态（新增/已解决/依旧），与行级 diff 互补
  const [diffView, setDiffView] = useState(false)
  const [diff, setDiff] = useState<AuditDiffResult | null>(null)
  const [diffErr, setDiffErr] = useState('')
  const [diffBusy, setDiffBusy] = useState(false)
  const [prevName, setPrevName] = useState('')
  // 模态无障碍：焦点圈闭 / Esc 关闭 / 滚动锁 / 关闭回焦（Apple HIG Keyboards）
  const panelRef = useRef<HTMLDivElement>(null)
  useModalA11y(open, panelRef, onClose)

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

  // 切换检查类别时收起对比视图（三态属于某一版的对照，不跨类）
  useEffect(() => {
    setDiffView(false)
    setDiff(null)
    setDiffErr('')
    setMadeDiff(new Set())
  }, [tab])

  /** 建提案公共体：有 target 才建，命中返回 true（清单/对比两视图共用同一规则） */
  const createProposalFor = async (it: AuditItem): Promise<boolean> => {
    if (!it.target) return false
    try {
      await window.zhijuan.createProposals(projectId, 'agent-chat', '', '', [
        { target: it.target, anchor: '', kind: 'append', before: '', after: it.suggest + '\n\n> 依据：' + it.what, reason: '巡查建议 · ' + (TYPE_TXT[it.type] ?? it.type) }
      ])
      return true
    } catch {
      return false
    }
  }
  const makeProposal = async (idx: number, it: AuditItem) => {
    if (await createProposalFor(it)) setMade((s) => new Set(s).add(idx))
  }
  const makeDiffProposal = async (key: string, it: AuditItem) => {
    if (await createProposalFor(it)) setMadeDiff((s) => new Set(s).add(key))
  }

  if (!open) return null
  const cur = res[tab]

  // 「与上次对比」：上一版 = 历史最新快照（重跑时旧版自动留档），本次 = 当前结构化结果（cur）
  const openDiff = async () => {
    if (!cur) return
    setDiffErr('')
    setDiff(null)
    setDiffView(true) // 点击即进入对比视图（加载中/失败提示都在视图内呈现）
    setDiffBusy(true)
    try {
      const kindName = K_TITLE[tab] ?? ''
      const rel = '大纲/审读_' + kindName + '.md'
      const list = await window.zhijuan.listHistory(projectId, rel)
      if (!list.length) {
        setDiffErr('还没有上一版可对比：先重跑一次本检查，下一版就可与此版对照。')
        return
      }
      const snap = list[0]
      const prevMd = await window.zhijuan.readHistory(projectId, rel, snap.name)
      const prev = parseAuditMarkdown(prevMd ?? '')
      if (!prev) {
        setDiffErr('上一版报告无法解析（可能是旧版工具生成的简化格式）。可点「版本历史」看行级对比。')
        return
      }
      setPrevName(snap.name)
      setDiff(diffAuditReports(prev, cur))
    } catch (e: any) {
      setDiffErr(String(e?.message ?? e))
    } finally {
      setDiffBusy(false)
    }
  }

  const diffItemCard = (it: AuditItem, extra?: { prevSeverity?: AuditItem['severity']; severityChanged?: boolean }, keyIdx: string | number = 0) => (
    <div key={keyIdx} className="mb-2 rounded-lg border border-hair bg-surface p-3">
      <div className="flex items-center gap-2">
        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', SEV_CN[it.severity])}>{it.severity}</span>
        <span className="text-[11px] font-medium text-accent">{TYPE_TXT[it.type] ?? it.type}</span>
        {it.viewer && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">{VIEWER_TXT[it.viewer] ?? it.viewer}</span>}
        {extra?.prevSeverity && extra.severityChanged && (
          <span className="flex items-center gap-1 text-[11px] text-warn" title="严重度等级与上次不同">严重度 {extra.prevSeverity} → {it.severity}</span>
        )}
        <span className="flex-1" />
        {onToAgent && (
          <button
            onClick={() => onToAgent(auditItemToAgentPrompt(it))}
            disabled={toAgentBusy}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-warn px-2 py-0.5 text-[11px] text-warn transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-3 w-3" /> 让 agent 改
          </button>
        )}
        {it.target &&
          (madeDiff.has(String(keyIdx)) ? (
            <span className="flex items-center gap-1 text-[11px] text-success"><Check className="h-3 w-3" /> 已建提案</span>
          ) : (
            <button
              onClick={() => void makeDiffProposal(String(keyIdx), it)}
              title={'创建修改提案到 ' + it.target + '（可在提案抽屉决定是否采纳）'}
              className="flex items-center gap-1 whitespace-nowrap rounded-md border border-hair px-2 py-0.5 text-[11px] text-ink-2 hover:border-accent hover:text-accent"
            >
              <AlertTriangle className="h-3 w-3" /> 转提案
            </button>
          ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-3">{it.where}</p>
      {it.refFile && (
        <p className="mt-1 text-[11px] text-ink-3">关联档案：<span className="text-accent">{it.refFile}</span></p>
      )}
      <p className="mt-1 text-xs text-ink">{it.what}</p>
      <p className="mt-1 text-[11px] text-ink-2">建议：{it.suggest}</p>
    </div>
  )

  const renderDiffView = () => {
    if (diffBusy)
      return (
        <p className="py-10 text-center text-xs text-ink-3">
          <LoadingIndicator size={12} className="mx-auto mb-2" /> 正在对照上一版…
        </p>
      )
    if (diffErr)
      return (
        <div className="py-10 text-center text-xs text-ink-3">
          <p className="mx-auto mb-2 max-w-[280px] leading-relaxed">{diffErr}</p>
          <button onClick={() => setDiffView(false)} className="text-accent hover:underline">返回列表</button>
        </div>
      )
    if (!diff || !cur) return null
    const c = diff.counts
    const sevChanged = diff.same.filter((s) => s.severityChanged).length
    const empty = c.added === 0 && c.resolved === 0 && c.same === 0
    return (
      <div>
        <div className="mb-3 flex items-center gap-2">
          <button onClick={() => setDiffView(false)} className="flex shrink-0 items-center gap-1 text-[11px] text-ink-3 hover:text-ink">
            <ChevronLeft className="h-3.5 w-3.5" /> 返回列表
          </button>
          <span className="flex-1" />
          <span className="text-[11px] text-ink-3">上一版 {prevName ? fmtTime(prevName) : ''} · 共 {c.prev} 条</span>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded bg-surface-2 px-2 py-1 text-ink-2">新增 <b className="text-warn">{c.added}</b></span>
          <span className="rounded bg-surface-2 px-2 py-1 text-ink-2">已解决 <b className="text-success">{c.resolved}</b></span>
          <span className="rounded bg-surface-2 px-2 py-1 text-ink-2">依旧 <b className="text-accent">{c.same}</b>{sevChanged ? `（其中 ${sevChanged} 条严重度变化）` : ''}</span>
        </div>
        {diff.shiftHint > 0 && (
          <p className="mb-3 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-[11px] leading-relaxed text-ink-2">
            ⚠ 有 {diff.shiftHint} 处同一位置「一增一消」——可能是模型换了个措辞，不一定是新问题，请人工核对。
          </p>
        )}
        {empty ? (
          <p className="py-10 text-center text-xs text-ink-3"><Sparkles className="mx-auto mb-2 h-6 w-6" /> 与上一版完全一致（结论没变）。</p>
        ) : (
          <>
            {diff.added.length > 0 && (
              <div className="mb-3">
                <p className="mb-1.5 text-[11px] font-semibold text-warn">新增（这次发现）</p>
                {diff.added.map((it, i) => diffItemCard(it, undefined, 'a' + i))}
              </div>
            )}
            {diff.resolved.length > 0 && (
              <div className="mb-3">
                <p className="mb-1.5 text-[11px] font-semibold text-success">已解决（上次提过，这次没再提）</p>
                {diff.resolved.map((it, i) => diffItemCard(it, undefined, 'r' + i))}
              </div>
            )}
            {diff.same.length > 0 && (
              <div className="mb-3">
                <p className="mb-1.5 text-[11px] font-semibold text-accent">依旧（两次都提）</p>
                {diff.same.map((s, i) => diffItemCard(s.item, { prevSeverity: s.prevSeverity, severityChanged: s.severityChanged }, 's' + i))}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/10 animate-in fade-in" onClick={onClose}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-label="全卷检查"
        className="flex h-full w-[440px] max-w-[92vw] flex-col border-l border-hair bg-surface shadow-[var(--shadow)] animate-in fade-in slide-in-from-right-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-hair px-4 py-3">
          <ShieldAlert className="h-4 w-4 text-accent" />
          <span className="text-sm font-semibold">
            {K_TITLE[tab] ?? '检查'}
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
          <button
            onClick={() => onTab('unused')}
            className={cn('rounded-md px-2.5 py-1 text-xs', tab === 'unused' ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-surface-2')}
          >
            档案
          </button>
          <button
            onClick={() => onTab('nameform')}
            className={cn('rounded-md px-2.5 py-1 text-xs', tab === 'nameform' ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-surface-2')}
          >
            称谓
          </button>
          <button onClick={onClose} className="text-ink-3 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-hair px-4 py-2 text-[11px] text-ink-3">
          <BookOpenCheck className="h-3.5 w-3.5" />
          {(running || !cur) && !err ? (
            <span className="flex items-center gap-1 text-accent">
              <LoadingIndicator size={12} /> {LOCAL_KINDS.includes(tab) ? '本地规则核查中…' : '写作引擎通读全卷…（几分钟）'}
            </span>
          ) : err ? (
            <span className="text-danger">{err}</span>
          ) : (
            <span>
              {LOCAL_KINDS.includes(tab)
                ? `本地规则核查：共列 ${cur!.items.length} 条（零模型·秒级，可随时重跑）。`
                : `全卷读完，共列 ${cur!.items.length} 条。可逐条转提案再决定是否采纳。`}
            </span>
          )}
          <span className="flex-1" />
          {cur && !running && !err && SAVED_KINDS.includes(tab) && (
            <button
              onClick={() => void openDiff()}
              disabled={diffBusy || diffView}
              className="flex shrink-0 items-center gap-1 whitespace-nowrap text-ink-3 transition-colors hover:text-accent disabled:opacity-40"
              title="对照上一版报告：新增 / 已解决 / 依旧（语义三态）"
            >
              <GitCompare className="h-3 w-3" /> 与上次对比
            </button>
          )}
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
          {diffView && renderDiffView()}
          {!diffView && (
            <>
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
              {it.refFile && (
                <p className="mt-1 text-[11px] text-ink-3">关联档案：<span className="text-accent">{it.refFile}</span></p>
              )}
              <p className="mt-1 text-xs text-ink">{it.what}</p>
              <p className="mt-1 text-[11px] text-ink-2">建议：{it.suggest}</p>
            </div>
          ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
