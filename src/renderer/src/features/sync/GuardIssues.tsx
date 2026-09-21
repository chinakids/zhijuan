import { useEffect, useRef, useState } from 'react'
import { ShieldAlert, ChevronDown, ChevronUp, FilePlus2, Check } from 'lucide-react'
import type { SyncIssue } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { guardIssueSummary } from './guardText'
import { personRelOf, isUnfiledIssue } from './guardCreate'
import { bulkQuickCreate } from './guardBulk'

/**
 * 守卫拦截提示（渐进披露两级，NN/g Progressive Disclosure：摘要常显、明细按需一层展开，不做更深层级）：
 * 摘要行 = 「拦截 N 条 · 查看」按钮；展开浮层逐条给处置徽标（已纠正/已丢弃）+ 原 target + 完整 reason。
 * 就近显示于同步结果旁（NN/g Error-Message Guidelines：Display close to the source）；
 * 浮层 z-40：永远低于批注抽屉遮罩(50)/划词浮层(60)/批注气泡(61)，高于正文内容。
 *
 * 快速建档（2026-09-15 创作层）：未建档型 dropped（unfiled）条目给「建档案」动作——
 * 按项目引导同款人物档案模板（shared/charDoc）写 人物/<名>.md（作者显式触发，与引导直写同口径，不经提案）；
 * 写前先 readDoc 查存在（已有档不覆盖——writeDoc 是覆盖写，绝不能覆盖作者手动档案）；
 * 建档后该条标记「已建档」，下次同步重跑（knownFiles 已含）自然不再拦截。projectId 缺省则不显示动作。
 * 批量建档（2026-09-22 创作层）：展开浮层列表上方「为 N 名人物建档案」一键按钮（N=未建档且未建档中条目，
 * 动态）——复用 guardBulk.bulkQuickCreate 同一实现（toast 批量建档 228a0dd 同语义：查存在不覆盖，
 * created+skipped 都标「已建档」=已有档案未改动），Sudowrite Generate All Characters 同构
 * （一个动作批量、处置后逐条仍可核）；作者显式点按，不违反「同步不替作者建档」。
 */
export function GuardIssuesNote({
  issues,
  className,
  projectId
}: {
  issues: SyncIssue[]
  className?: string
  projectId?: string
}) {
  const [open, setOpen] = useState(false)
  // 已快速建档的 target 集（或写盘前发现已存在）：该条 UI 转为「已建档」，不再可处置
  const [created, setCreated] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState<Set<string>>(new Set())
  // 批量建档进行中（复用 bulkQuickCreate；逐条按钮与批量共用 created 集与写盘语义）
  const [bulkBusy, setBulkBusy] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function quickCreate(it: SyncIssue) {
    if (!projectId || !personRelOf(it.target) || created.has(it.target) || creating.has(it.target)) return
    setCreating((s) => new Set(s).add(it.target))
    try {
      // 与 toast 批量建档同一实现：已有档案（作者在别处已建、列表未刷新）→ 不覆盖，仅标记已建档
      const { created: c, skipped: sk } = await bulkQuickCreate(projectId, [it])
      if (c.length || sk.length) setCreated((s) => new Set(s).add(it.target))
    } finally {
      setCreating((s) => {
        const n = new Set(s)
        n.delete(it.target)
        return n
      })
    }
  }

  // 未建档且未建档中的条目（批量按钮 N 的动态基数；作者已处置/已有档案的不再计入）
  const unfiledOpen = issues.filter(
    (it) => isUnfiledIssue(it) && !created.has(it.target) && !!personRelOf(it.target)
  )

  async function quickCreateAll() {
    if (!projectId || bulkBusy || !unfiledOpen.length) return
    setBulkBusy(true)
    try {
      // 与单条/toast 批量同一实现：查存在不覆盖；created+skipped 都标记（skip=作者在别处已建，仅标记）
      const { created: c, skipped: sk } = await bulkQuickCreate(projectId, unfiledOpen)
      if (c.length || sk.length) {
        setCreated((s) => {
          const n = new Set(s)
          for (const t of [...c, ...sk]) n.add(t)
          return n
        })
      }
    } finally {
      setBulkBusy(false)
    }
  }

  const isUnfiled = (it: SyncIssue) => isUnfiledIssue(it)

  if (!issues || !issues.length) return null
  return (
    <span ref={rootRef} className={cn('relative inline-flex items-center', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`守卫拦截 ${issues.length} 条，查看明细`}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-warn/40 bg-warn-soft px-1.5 py-0.5 text-[10px] text-warn transition-colors hover:border-warn/70"
      >
        <ShieldAlert className="h-3 w-3" />
        {guardIssueSummary(issues)}
        查看
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div
          role="group"
          aria-label="守卫拦截明细"
          className="absolute left-0 top-full z-40 mt-1 w-[min(70vw,420px)] rounded-xl border border-hair bg-surface p-2 shadow-[var(--shadow)] animate-in fade-in slide-in-from-top-1 duration-150"
        >
          {unfiledOpen.length > 0 && (
            <div className="mb-1.5 flex justify-end">
              <button
                type="button"
                data-testid="guard-bulk-create"
                disabled={bulkBusy}
                onClick={(e) => {
                  e.stopPropagation()
                  void quickCreateAll()
                }}
                title={`按人物档案模板为 ${unfiledOpen.length} 名未建档人物建档，下次同步不再拦截`}
                className="inline-flex shrink-0 items-center gap-0.5 rounded border border-accent/50 px-1.5 py-0.5 text-[10px] text-accent transition-colors hover:bg-accent-soft disabled:opacity-50"
              >
                {bulkBusy ? (
                  '建档中…'
                ) : (
                  <>
                    <FilePlus2 className="h-2.5 w-2.5" /> 为 {unfiledOpen.length} 名人物建档案
                  </>
                )}
              </button>
            </div>
          )}
          <ul className="space-y-1.5">
            {issues.map((it, i) => {
              const done = created.has(it.target)
              const busy = creating.has(it.target)
              return (
                <li key={i} className="rounded-lg bg-surface-2 px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        'shrink-0 rounded px-1 py-px text-[10px]',
                        done
                          ? 'bg-success-soft text-success'
                          : it.action === 'corrected'
                            ? 'bg-accent-soft text-accent'
                            : 'bg-warn-soft text-warn'
                      )}
                    >
                      {done ? '已建档' : it.action === 'corrected' ? '已纠正' : '已丢弃'}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink" title={it.target}>
                      {it.target}
                    </span>
                    {done ? (
                      <Check className="h-3 w-3 shrink-0 text-success" />
                    ) : isUnfiled(it) && projectId ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation()
                          void quickCreate(it)
                        }}
                        title="按人物档案模板快速建档，下次同步不再拦截"
                        className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded border border-accent/50 px-1 py-px text-[10px] text-accent transition-colors hover:bg-accent-soft disabled:opacity-50"
                      >
                        {busy ? '建档中…' : (
                          <>
                            <FilePlus2 className="h-2.5 w-2.5" /> 建档案
                          </>
                        )}
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-4 text-ink-2">
                    {done ? '已快速建档，重新触发同步后不再拦截' : it.reason}
                  </p>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </span>
  )
}
