import { useState } from 'react'
import type { Project } from '../../../shared/types'

interface Props {
  project: Project
  onSave: (p: Project) => void
}

export default function WorldviewView({ project, onSave }: Props) {
  const wv = project.worldview
  const [themesText, setThemesText] = useState(wv.themes.join('、'))
  const [rulesText, setRulesText] = useState(wv.rules.join('；'))

  function update(patch: Partial<typeof wv>) {
    onSave({ ...project, worldview: { ...wv, ...patch } })
  }

  function saveList() {
    update({
      themes: themesText.split(/[、，,\n]/).map((s) => s.trim()).filter(Boolean),
      rules: rulesText.split(/(?:；|\n)/).map((s) => s.trim()).filter(Boolean)
    })
  }

  return (
    <div className="panel">
      <h2>🌍 世界观背景</h2>
      <p className="hint">这里定义整部作品的舞台与前设。后续所有章节生成都会以此为底。</p>

      <div className="grid-2">
        <label>
          世界观名
          <input value={wv.name} onChange={(e) => update({ name: e.target.value })} placeholder="如：岚州" />
        </label>
        <label>
          城市 / 舞台
          <input value={wv.city} onChange={(e) => update({ city: e.target.value })} placeholder="如：架空一线城市·岚州" />
        </label>
        <label>
          时代背景
          <input value={wv.era} onChange={(e) => update({ era: e.target.value })} placeholder="如：当代，纪律森严的封闭式高中" />
        </label>
        <label>
          主题关键词（顿号分隔）
          <input value={themesText} onChange={(e) => setThemesText(e.target.value)} onBlur={saveList} placeholder="如：纯肉体征服、清冷校花、身份反差" />
        </label>
        <label className="full">
          世界规则 / 前设约束（分号分隔）
          <textarea value={rulesText} onChange={(e) => setRulesText(e.target.value)} onBlur={saveList} rows={3} placeholder="如：主角凭校工身份可正当出入片区任意学校；设定与人物身份必须自洽" />
        </label>
      </div>

      <label className="block">
        背景长文设定
        <textarea
          className="tall"
          value={wv.background}
          onChange={(e) => update({ background: e.target.value })}
          placeholder="完整的世界观底稿，可自由撰写…"
        />
      </label>

      <p className="saved-tip">内容即时保存到本地项目文件 ✅</p>
    </div>
  )
}
