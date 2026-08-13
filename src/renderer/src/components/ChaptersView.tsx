import { useState } from 'react'
import type { Project, Chapter, SeriesCurve, PlotBeat } from '../../../shared/types'
import CurveEditor from './CurveEditor'
import { applySweeps, rejectSweeps } from '../../../shared/sweeper'

interface Props {
  project: Project
  onSave: (p: Project) => void
}

function newId(prefix: string) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

const PALETTE = ['#ff5d73', '#ffd166', '#4cc9f0', '#b388ff', '#7ae582', '#ff8c42']

function defaultCurves(chars: Project['characters']): SeriesCurve[] {
  const curves: SeriesCurve[] = [
    { id: newId('em'), kind: 'emotion', name: '整体张力', color: '#ff5d73', points: [] },
    { id: newId('em'), kind: 'emotion', name: '甜腻度', color: '#ffd166', points: [] },
    { id: newId('em'), kind: 'emotion', name: '压迫感', color: '#4cc9f0', points: [] }
  ]
  chars.forEach((c, i) => {
    curves.push({
      id: newId('ch'),
      kind: 'character',
      name: c.name + '·防线',
      color: PALETTE[(i + 3) % PALETTE.length],
      points: []
    })
  })
  return curves
}

export default function ChaptersView({ project, onSave }: Props) {
  const chapters = [...project.chapters].sort((a, b) => a.num - b.num)
  const [selectedId, setSelectedId] = useState<string | null>(chapters[0]?.id ?? null)
  const selected = project.chapters.find((c) => c.id === selectedId) ?? null
  const [lastComposition, setLastComposition] = useState('')
  const [auditLoading, setAuditLoading] = useState(false)

  function saveChapters(chs: Chapter[]) {
    onSave({ ...project, chapters: chs })
  }

  function updateChapter(id: string, patch: Partial<Chapter>) {
    saveChapters(
      project.chapters.map((c) =>
        c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c
      )
    )
  }

  function addChapter() {
    const n = Math.max(0, ...project.chapters.map((c) => c.num)) + 1
    const ch: Chapter = {
      id: newId('ch'),
      num: n,
      title: `第${n}章`,
      status: 'plan',
      elements: '',
      premise: '',
      curves: defaultCurves(project.characters),
      beats: [],
      content: '',
      updatedAt: Date.now()
    }
    saveChapters([...project.chapters, ch])
    setSelectedId(ch.id)
  }

  function removeChapter(id: string) {
    saveChapters(project.chapters.filter((c) => c.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  async function doGenerate() {
    if (!selected) return
    const result = (await window.zhijuan.generate(
      project,
      selected,
      { baseUrl: 'http://127.0.0.1:8888/v1', model: 'deepseek-v4-flash-0731', apiKey: 'EMPTY' }
    )) as { ok: boolean; text?: string; error?: string; prompt?: string; composition?: string }
    if (result.ok && result.text) {
      updateChapter(selected.id, { content: result.text, status: 'draft' })
      setLastComposition(result.composition ?? '')
    } else {
      alert('生成失败：' + (result.error ?? '未知错误'))
    }
  }

  async function doExport() {
    if (!selected) return
    const path = (await window.zhijuan.exportChapter(project, selected)) as string
    alert('已导出到：' + path)
  }

  // —— 章节沉淀：生成记录（AI 只出草稿，主人确认后才进时间线）——
  async function doAudit() {
    if (!selected || !selected.content.trim()) return
    setAuditLoading(true)
    try {
      const res = await window.zhijuan.auditGenerate(project, selected, {
        baseUrl: 'http://127.0.0.1:8888/v1',
        model: 'deepseek-v4-flash-0731',
        apiKey: 'EMPTY'
      })
      if (res.ok && res.drafts?.length) {
        onSave({ ...project, sweepDrafts: [...project.sweepDrafts, ...res.drafts] })
      } else {
        alert('没有生成到可确认内容：' + (res.error ?? '未知错误'))
      }
    } finally {
      setAuditLoading(false)
    }
  }

  function acceptDrafts(ids: string[]) {
    const r = applySweeps(project, ids)
    onSave({
      ...project,
      characters: r.characters,
      elements: r.elements,
      records: r.records,
      foreshadows: r.foreshadows,
      sweepDrafts: r.drafts
    })
  }

  function declineDrafts(ids: string[]) {
    onSave({ ...project, sweepDrafts: rejectSweeps(project, ids) })
  }

  const pendingDrafts = project.sweepDrafts.filter((d) => d.status === 'pending')
  const thisRecord = selected ? project.records.find((r) => r.chapterNum === selected.num) : null

  return (
    <div className="panel chapters-panel">
      <div className="panel-head">
        <h2>📖 章节</h2>
        <button className="btn btn-primary btn-sm" onClick={addChapter}>
          ＋ 新章节
        </button>
      </div>

      <div className="chapters-body">
        <aside className="chap-list">
          {chapters.map((c) => (
            <div
              key={c.id}
              className={`chap-item ${c.id === selectedId ? 'active' : ''}`}
              onClick={() => setSelectedId(c.id)}
            >
              <strong>
                {c.num}. {c.title}
              </strong>
              <small>
                {c.status === 'done' ? '✅ 完成' : c.status === 'draft' ? '📝 草稿' : '🧭 规划中'}
              </small>
            </div>
          ))}
          {chapters.length === 0 && <p className="empty">还没有章节，点右上角新建。</p>}
        </aside>

        {selected && (
          <div className="chap-edit">
            <div className="grid-3">
              <label>
                标题
                <input value={selected.title} onChange={(e) => updateChapter(selected.id, { title: e.target.value })} />
              </label>
              <label>
                状态
                <select
                  value={selected.status}
                  onChange={(e) => updateChapter(selected.id, { status: e.target.value as Chapter['status'] })}
                >
                  <option value="plan">规划中</option>
                  <option value="draft">草稿</option>
                  <option value="done">完成</option>
                </select>
              </label>
              <div className="btn-row">
                <button className="btn btn-primary" onClick={doGenerate}>
                  ✨ 生成本章
                </button>
                <button className="btn" onClick={doExport}>
                  📤 导出
                </button>
              </div>
            </div>

            <label className="block">
              本章要素（原始要求，生成时逐条落实）
              <textarea
                value={selected.elements}
                onChange={(e) => updateChapter(selected.id, { elements: e.target.value })}
                rows={3}
                placeholder="如：她进门就被按住，唇封，墙边把杆，正面压身，三次尽根…"
              />
            </label>
            <label className="block">
              本章梗概
              <textarea value={selected.premise} onChange={(e) => updateChapter(selected.id, { premise: e.target.value })} rows={2} />
            </label>

            <h4>情感与人物曲线（点击画面加控制点，拖拽调整；每次添加人物会自动多一条“防线”曲线）</h4>
            <div className="curves">
              {selected.curves.map((c) => (
                <CurveEditor
                  key={c.id}
                  curve={c}
                  beats={selected.beats}
                  onChange={(points) =>
                    updateChapter(selected.id, {
                      curves: selected.curves.map((cc) => (cc.id === c.id ? { ...cc, points } : cc))
                    })
                  }
                  onAddBeat={(x) => {
                    const label = prompt('情节点名：', '关键节点')
                    if (label === null) return
                    const note = prompt('说明（该点发生什么）：', '') ?? ''
                    const beat: PlotBeat = { id: newId('b'), at: x, label: label.slice(0, 20), note }
                    updateChapter(selected.id, { beats: [...selected.beats, beat] })
                  }}
                  onRemoveBeat={(id) =>
                    updateChapter(selected.id, { beats: selected.beats.filter((b) => b.id !== id) })
                  }
                />
              ))}
            </div>

            <h4>情节点（按进度列出，可删）</h4>
            <div className="beats">
              {selected.beats
                .slice()
                .sort((a, b) => a.at - b.at)
                .map((b) => (
                  <span key={b.id} className="beat-chip">
                    <b>{b.at}%</b> {b.label} · {b.note}
                    <button onClick={() => updateChapter(selected.id, { beats: selected.beats.filter((x) => x.id !== b.id) })}>
                      ✕
                    </button>
                  </span>
                ))}
              {selected.beats.length === 0 && <span className="muted">未设置。可在曲线上点击“加情节点”来标记位置。</span>}
            </div>

            {lastComposition && (
              <div className="comp-bar">
                <strong>本次组配（动它之前先看这里 👀）</strong>
                <pre>{lastComposition}</pre>
              </div>
            )}

            <h4>生成的正文</h4>
            <textarea
              className="content"
              value={selected.content}
              onChange={(e) => updateChapter(selected.id, { content: e.target.value })}
              placeholder="点「✨ 生成本章」让 AI 按上面的要素、曲线和情节点写出正文；也可以直接在这里手写或修改。"
            />

            <div className="sweep-box">
              <div className="panel-head sweep-head-bar">
                <h4>📝 章节沉淀（设定随正文生长）</h4>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={doAudit}
                  disabled={auditLoading || !selected.content.trim()}
                >
                  {auditLoading ? '审计中…' : '生成本章记录 & 检测变化'}
                </button>
              </div>
              <p className="hint">把本章正文交给模型总结出「章节记录 + 人物状态推进 + 伏笔」；变化先成草稿，你确认后才进时间线。</p>

              {thisRecord && (
                <div className="tl-item">
                  <div className="tl-head">
                    <span className="tl-badge">第 {thisRecord.chapterNum} 章记录 ✅</span>
                  </div>
                  <div className="tl-content">{thisRecord.summary}</div>
                  {thisRecord.sown.length > 0 && <small className="tl-log">新埋伏笔：{thisRecord.sown.join('；')}</small>}
                  {thisRecord.resolved.length > 0 && (
                    <small className="tl-log" style={{ color: '#5dd39e' }}>
                      兑现伏笔：{thisRecord.resolved.join('；')}
                    </small>
                  )}
                </div>
              )}

              {pendingDrafts.length > 0 && (
                <div className="sweep-list">
                  {pendingDrafts.map((d) => (
                    <div key={d.id} className="sweep-item">
                      <div className="sweep-head">
                        <span className="tl-badge">{d.targetId.startsWith('record:') ? '章节记录' : '人物状态变化'}</span>
                        <b>{d.targetName}</b>
                      </div>
                      <div className="sweep-log">原因：{d.changeLog}</div>
                      <pre className="sweep-preview">{d.draftContent}</pre>
                      <div className="btn-row">
                        <button className="btn btn-sm btn-primary" onClick={() => acceptDrafts([d.id])}>
                          ✓ 接受
                        </button>
                        <button className="btn btn-sm" onClick={() => declineDrafts([d.id])}>
                          拒绝
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="btn-row">
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => acceptDrafts(pendingDrafts.map((d) => d.id))}
                    >
                      全部接受
                    </button>
                    <button className="btn btn-sm" onClick={() => declineDrafts(pendingDrafts.map((d) => d.id))}>
                      全部拒绝
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
