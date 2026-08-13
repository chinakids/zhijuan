import { useState } from 'react'
import type { Project, Element, SettingSlice } from '../../../shared/types'

interface Props {
  project: Project
  onSave: (p: Project) => void
}

const KINDS: { k: Element['kind']; label: string }[] = [
  { k: 'rule', label: '规则' },
  { k: 'scene', label: '场景' },
  { k: 'prop', label: '道具' },
  { k: 'lore', label: '设定' },
  { k: 'other', label: '其他' }
]

function newId() {
  return 'e_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** 取「到第 ch 章为止」最新有效的切片（时间旅行查询） */
function sliceAt(slices: SettingSlice[], ch: number): SettingSlice | null {
  const valid = slices.filter((s) => s.atChapter <= ch)
  return valid.length ? valid[valid.length - 1] : null
}

const SRC_LABEL: Record<SettingSlice['source'], string> = {
  initial: '初始设定',
  sweep: '随正文沉淀',
  manual: '手动' 
}

const KIND_LABEL: Record<Element['kind'], string> = {
  rule: '规则',
  scene: '场景',
  prop: '道具',
  lore: '设定',
  other: '其他'
}

export default function ElementsView({ project, onSave }: Props) {
  const maxChapter = Math.max(0, ...project.chapters.map((c) => c.num || 0))
  const [selectedId, setSelectedId] = useState<string | null>(project.elements[0]?.id ?? null)
  // 时间线查看章位：默认 maxChapter+1 = 「最新」；拖动滑块可看到任何章位的设定快照
  const [ch, setCh] = useState<number>(maxChapter + 1)
  const [adding, setAdding] = useState(false)
  const [newAt, setNewAt] = useState<number>(maxChapter + 1)
  const [newContent, setNewContent] = useState('')
  const [newLog, setNewLog] = useState('')

  const selected = project.elements.find((el) => el.id === selectedId) ?? null
  const currentContent = selected ? (sliceAt(selected.slices, maxChapter + 1)?.content ?? '') : ''

  function saveElements(elements: Element[]) {
    onSave({ ...project, elements })
  }

  function updateEl(id: string, patch: Partial<Element>) {
    saveElements(project.elements.map((el) => (el.id === id ? { ...el, ...patch, updatedAt: Date.now() } : el)))
  }

  function addElement() {
    const el: Element = {
      id: newId(),
      kind: 'rule',
      name: '新条目',
      tags: [],
      active: true,
      slices: [{ atChapter: 1, content: '', source: 'initial', confirmed: true }],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    saveElements([...project.elements, el])
    setSelectedId(el.id)
  }

  function removeElement(id: string) {
    saveElements(project.elements.filter((el) => el.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  /** 编辑当前内容 = 更新最后一个切片（保持「最后切片 = 当前值」，不堆历史）；堆历史走下方手动打点或章节沉淀 */
  function updateCurrentContent(id: string, content: string) {
    const el = project.elements.find((e) => e.id === id)
    if (!el) return
    const slices = el.slices.length
      ? [...el.slices.slice(0, -1), { ...el.slices[el.slices.length - 1], content }]
      : [{ atChapter: 1, content, source: 'initial' as const, confirmed: true }]
    updateEl(id, { slices })
  }

  function openAddSlice() {
    setNewAt(maxChapter + 1)
    setNewContent(currentContent)
    setNewLog('')
    setAdding(true)
  }

  function commitAddSlice() {
    if (!selected) return
    const slice: SettingSlice = {
      atChapter: Math.max(1, Math.floor(Number(newAt) || 1)),
      content: newContent,
      changeLog: newLog.trim() || undefined,
      source: 'manual',
      confirmed: true
    }
    updateEl(selected.id, { slices: [...selected.slices, slice] })
    setAdding(false)
  }

  return (
    <div className="panel elems-panel">
      <div className="panel-head">
        <h2>🧩 设定库</h2>
        <button className="btn btn-primary btn-sm" onClick={addElement}>
          ＋ 新条目
        </button>
      </div>
      <p className="hint">
        规则 / 场景 / 道具按条目维护，每条带自己的时间线。生成时只取「到本章为止」的切片，后文的设定不会提前泄出。
      </p>

      {/* 时间线滑块：查看任一章节时刻的设定快照 */}
      {project.elements.length > 0 && (
        <div className="tl-bar">
          <label>
            <span>
              时间线查看 —— 当前显示「第 {ch} 章时」的设定状态{ch > maxChapter ? '（最新）' : ''}
            </span>
            <input
              type="range"
              min={1}
              max={Math.max(1, maxChapter + 1)}
              value={ch}
              onChange={(e) => setCh(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      <div className="elems-body">
        <aside className="elem-list">
          {project.elements.map((el) => {
            const cur = sliceAt(el.slices, ch)
            return (
              <div
                key={el.id}
                className={`elem-item ${el.id === selectedId ? 'active' : ''} ${!el.active ? 'off' : ''}`}
                onClick={() => setSelectedId(el.id)}
              >
                <strong>{el.name}</strong>
                <small>
                  {KIND_LABEL[el.kind]}
                  {el.tags.length ? ' · ' + el.tags.join('、') : ''}
                  {!el.active ? ' · 已停用' : ''}
                </small>
                <small className="tl-hint">第 {ch} 章时：{cur ? (cur.content || '（空）') : '（尚未生效）'}</small>
              </div>
            )
          })}
          {project.elements.length === 0 && <p className="empty">还没有设定条目。</p>}
        </aside>

        {selected && (
          <div className="elem-edit">
            <div className="grid-2">
              <label>
                名称
                <input value={selected.name} onChange={(e) => updateEl(selected.id, { name: e.target.value })} />
              </label>
              <label>
                分类
                <select value={selected.kind} onChange={(e) => updateEl(selected.id, { kind: e.target.value as Element['kind'] })}>
                  {KINDS.map((k) => (
                    <option key={k.k} value={k.k}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              标签（顿号分隔，供按需召回）
              <input
                value={selected.tags.join('、')}
                onChange={(e) =>
                  updateEl(selected.id, {
                    tags: e.target.value.split(/[、，,]/).map((s) => s.trim()).filter(Boolean)
                  })
                }
                placeholder="如：学校、更衣室、异能档位"
              />
            </label>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={selected.active}
                onChange={(e) => updateEl(selected.id, { active: e.target.checked })}
              />
              启用（停用的条目不参与生成与召回）
            </label>

            <label className="block">
              内容（编辑即改「当前生效」；过去各章的样子可在下方时间线里回看）
              <textarea
                className="tall"
                value={currentContent}
                onChange={(e) => updateCurrentContent(selected.id, e.target.value)}
                placeholder="设定正文…"
              />
            </label>

            {/* 时间线（按章演进） */}
            <h4>时间线（按章演进 · {selected.slices.length} 个切片）</h4>
            <div className="tl-list">
              {selected.slices.map((s, i) => (
                <div key={i} className={`tl-item ${s.atChapter > ch ? 'future' : ''}`}>
                  <div className="tl-head">
                    <span className="tl-badge">第 {s.atChapter} 章起 · {SRC_LABEL[s.source]}</span>
                    {s.confirmed === false && <span className="tl-badge warn">待确认</span>}
                  </div>
                  <pre className="tl-content">{s.content || '（空）'}</pre>
                  {s.changeLog && <small className="tl-log">变化：{s.changeLog}</small>}
                </div>
              ))}
            </div>

            {adding ? (
              <div className="add-slice">
                <label>
                  从第几章起生效
                  <input type="number" min={1} value={newAt} onChange={(e) => setNewAt(Number(e.target.value))} />
                </label>
                <label>
                  该切片的设定内容
                  <textarea rows={3} value={newContent} onChange={(e) => setNewContent(e.target.value)} />
                </label>
                <label>
                  变化说明（可选）
                  <input value={newLog} onChange={(e) => setNewLog(e.target.value)} placeholder="为什么变成了这样" />
                </label>
                <div className="btn-row">
                  <button className="btn btn-primary btn-sm" onClick={commitAddSlice}>
                    存为新切片
                  </button>
                  <button className="btn btn-sm" onClick={() => setAdding(false)}>
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn btn-sm" onClick={openAddSlice}>
                ＋ 在此条目上打一个手动画点（记录某个阶段的设定）
              </button>
            )}

            <div className="char-actions">
              <button className="btn btn-danger btn-sm" onClick={() => removeElement(selected.id)}>
                删除该条目
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
