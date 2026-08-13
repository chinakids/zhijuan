import { useState } from 'react'
import type { Project, Character } from '../../../shared/types'

interface Props {
  project: Project
  onSave: (p: Project) => void
}

function newId() {
  return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export default function CharactersView({ project, onSave }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(project.characters[0]?.id ?? null)
  const selected = project.characters.find((c) => c.id === selectedId) ?? null

  function saveChars(chars: Character[]) {
    onSave({ ...project, characters: chars })
  }

  function updateChar(id: string, patch: Partial<Character>) {
    saveChars(project.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  function addChar() {
    const c: Character = {
      id: newId(),
      name: '新角色',
      role: '配角',
      age: 18,
      isProtagonist: false,
      tags: [],
      fields: [],
      background: '',
      relation: ''
    }
    saveChars([...project.characters, c])
    setSelectedId(c.id)
  }

  function removeChar(id: string) {
    saveChars(project.characters.filter((c) => c.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  function updateField(id: string, idx: number, patch: Partial<{ key: string; value: string }>) {
    updateChar(id, { fields: selected!.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)) })
  }

  return (
    <div className="panel chars-panel">
      <div className="panel-head">
        <h2>👤 人物设定</h2>
        <button className="btn btn-primary btn-sm" onClick={addChar}>
          ＋ 新人物
        </button>
      </div>

      <div className="chars-body">
        <aside className="char-list">
          {project.characters.map((c) => (
            <div
              key={c.id}
              className={`char-item ${c.id === selectedId ? 'active' : ''}`}
              onClick={() => setSelectedId(c.id)}
            >
              <strong>{c.name}</strong>
              <small>
                {c.role} · {c.age}岁{c.isProtagonist ? ' · 主角' : ''}
              </small>
            </div>
          ))}
          {project.characters.length === 0 && <p className="empty">还没有人物，点右上角新建。</p>}
        </aside>

        {selected && (
          <div className="char-edit">
            <div className="grid-2">
              <label>
                姓名
                <input value={selected.name} onChange={(e) => updateChar(selected.id, { name: e.target.value })} />
              </label>
              <label>
                年龄
                <input
                  type="number"
                  value={selected.age}
                  onChange={(e) => updateChar(selected.id, { age: Number(e.target.value) || 0 })}
                />
              </label>
              <label>
                定位
                <input
                  value={selected.role}
                  onChange={(e) => updateChar(selected.id, { role: e.target.value })}
                  placeholder="男主 / 女主 / 配角"
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={selected.isProtagonist}
                  onChange={(e) => updateChar(selected.id, { isProtagonist: e.target.checked })}
                />
                贯穿主角（如陈默式人物）
              </label>
            </div>

            <label className="block">
              标签（顿号分隔）
              <input
                value={selected.tags.join('、')}
                onChange={(e) =>
                  updateChar(selected.id, {
                    tags: e.target.value.split(/[、，,]/).map((s) => s.trim()).filter(Boolean)
                  })
                }
                placeholder="如：处子、清冷、校花"
              />
            </label>

            <label className="block">
              身世背景
              <textarea value={selected.background} onChange={(e) => updateChar(selected.id, { background: e.target.value })} rows={3} />
            </label>
            <label className="block">
              与主角关系 / 定位
              <textarea value={selected.relation} onChange={(e) => updateChar(selected.id, { relation: e.target.value })} rows={2} />
            </label>

            <h4>身体档案（可自由增删字段，如：皮肤、体态、声音、胸部、乳头乳晕、三角区、阴毛、外阴、玉足…）</h4>
            {selected.fields.map((f, i) => (
              <div className="field-row" key={i}>
                <input
                  className="field-key"
                  value={f.key}
                  placeholder="部位/项"
                  onChange={(e) => updateField(selected.id, i, { key: e.target.value })}
                />
                <input
                  className="field-val"
                  value={f.value}
                  placeholder="描述…"
                  onChange={(e) => updateField(selected.id, i, { value: e.target.value })}
                />
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => updateChar(selected.id, { fields: selected.fields.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              className="btn btn-sm"
              onClick={() => updateChar(selected.id, { fields: [...selected.fields, { key: '', value: '' }] })}
            >
              ＋ 字段
            </button>

            <div className="char-actions">
              <button className="btn btn-danger btn-sm" onClick={() => removeChar(selected.id)}>
                删除该人物
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
