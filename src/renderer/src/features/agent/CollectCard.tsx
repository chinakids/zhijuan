import { useEffect, useState } from 'react'
import { Check, CloudDownload, X } from 'lucide-react'
import { normDemand, parseTaskCard, taskCardDoc, taskCardFileName } from '../../../../shared/taskCard'
import type { CollectSuggestion } from '../../../../shared/types'
import { useAgentStore } from './store'

/** agent 素材采集建议卡（2026-09-29 智能层候选 1，模块设计 §6.4「agent 建议素材采集（生成任务卡草稿）」）：
 * zj_collect_suggest 只出建议不写盘；作者「创建采集任务」→ 落 素材库/采集池/任务_<ts>.md
 * （status: pending=管道唯一处理判据）→ 本机管道按既有约定抓取回填成素材；「忽略」放弃建议。
 * 与 EditCard 同范式：模型出建议 → 作者显式动作才落资产（正文为源、结论必落资产）。 */
export default function CollectCard({
  id,
  suggestion,
  projectId,
  state,
  result
}: {
  id: string
  suggestion: CollectSuggestion
  projectId: string
  state?: 'pending' | 'created' | 'ignored'
  result?: string
}) {
  const [busy, setBusy] = useState(false)
  const [category, setCategory] = useState(suggestion.category)
  const [cats, setCats] = useState<string[] | null>(null)
  const st = state ?? 'pending'

  // 现有素材库类别（目录=类别）：供确认时参考/改类（模型建议类别可能不在清单内）
  useEffect(() => {
    let alive = true
    void window.zhijuan
      .listLibraryCategories(projectId)
      .then((cs) => {
        if (alive) setCats(cs.map((c) => c.name))
      })
      .catch(() => {
        /* 读不到不阻塞建议卡（类别仍可手输） */
      })
    return () => {
      alive = false
    }
  }, [projectId])

  async function create() {
    if (busy || st !== 'pending') return
    setBusy(true)
    try {
      // 查重（与「发起采集」表单同口径 1b0a630）：同需求非终态任务已存在 → 不再重复建卡
      const list = await window.zhijuan.listDocs(projectId, '素材库/采集池')
      let dupFile = ''
      const nd = normDemand(suggestion.demand)
      for (const d of list) {
        if (!d.file.endsWith('.md')) continue
        const text = (await window.zhijuan.readDoc(projectId, '素材库/采集池/' + d.file)) ?? ''
        const v = parseTaskCard(text)
        if ((v.status === 'pending' || v.status === 'running') && normDemand(v.demand) === nd) {
          dupFile = d.file
          break
        }
      }
      if (dupFile) {
        useAgentStore.getState().setCollectState(id, 'created', '已有进行中的同需求任务（' + dupFile + '），未重复创建')
        return
      }
      const ts = Date.now()
      const name = taskCardFileName(ts)
      const ok = await window.zhijuan.writeDoc(
        projectId,
        '素材库/采集池/' + name + '.md',
        taskCardDoc({ demand: suggestion.demand, keywords: suggestion.keywords, category, note: suggestion.note, ts })
      )
      useAgentStore.getState().setCollectState(
        id,
        'created',
        ok ? '已创建采集任务 ' + name + '，本机管道将按需求抓取回填' : '创建采集任务失败，可重试'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-accent/30 bg-surface p-3">
      <div className="flex items-center gap-1.5">
        <CloudDownload className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title="agent 建议采集的素材，确认后创建采集任务">
          建议采集素材
        </span>
        {st === 'created' && <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] text-success">已创建</span>}
        {st === 'ignored' && <span className="rounded-full bg-ink-soft px-2 py-0.5 text-[10px] text-ink-3">已忽略</span>}
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-ink">{suggestion.demand}</p>
      {suggestion.keywords.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {suggestion.keywords.map((k) => (
            <span key={k} className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-2">
              {k}
            </span>
          ))}
        </div>
      )}
      {suggestion.note && <p className="mt-1.5 text-[10px] leading-4 text-ink-3">{suggestion.note}</p>}
      <div className="mt-2 flex items-center gap-1.5">
        <span className="shrink-0 text-[10px] text-ink-3">类别</span>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          data-testid="zj-collect-category"
          className="h-6 min-w-0 flex-1 rounded border border-hair-strong bg-surface px-1.5 text-[11px] text-ink"
          title="采集素材放入的素材库类别（可改）"
          placeholder="环境"
        />
        {st === 'pending' ? (
          <>
            <button
              type="button"
              onClick={() => void create()}
              disabled={busy || !category.trim()}
              data-testid="zj-collect-create"
              className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded border border-hair bg-surface px-1.5 text-[11px] text-ink transition-colors hover:bg-surface-2 active:bg-well disabled:pointer-events-none disabled:opacity-50"
            >
              <Check className="h-3 w-3" /> 创建采集任务
            </button>
            <button
              type="button"
              onClick={() => useAgentStore.getState().setCollectState(id, 'ignored')}
              data-testid="zj-collect-ignore"
              className="inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded border border-hair bg-surface px-1.5 text-[11px] text-ink-2 transition-colors hover:bg-surface-2 active:bg-well"
            >
              <X className="h-3 w-3" /> 忽略
            </button>
          </>
        ) : null}
      </div>
      {cats != null && cats.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-ink-3">现有类别：</span>
          {cats.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              data-testid={'zj-collect-cat-' + c}
              className="rounded-full border border-hair px-1.5 py-px text-[10px] text-ink-2 transition-colors hover:border-accent/60 hover:text-accent"
            >
              {c}
            </button>
          ))}
        </div>
      )}
      {busy && <p className="mt-1.5 text-[10px] leading-4 text-ink-3">正在创建…</p>}
      {st === 'created' && result && (
        <p className="mt-1.5 text-[10px] leading-4 text-ink-3" data-testid="zj-collect-result">
          {result}
        </p>
      )}
    </div>
  )
}
