// 织卷 · 沉淀为条目（melt）· 纯逻辑
// 把一大段设定文字交给模型拆成「条目草稿」，同样走 SweepDraft 确认通道，确认后才真正建立条目。
import type { SweepDraft } from './types.ts'

export interface MeltElement {
  kind: 'rule' | 'scene' | 'prop' | 'lore' | 'other'
  name: string
  tags: string[]
  content: string
}

export interface MeltResult {
  elements: MeltElement[]
  error?: string
}

/** 从 LLM 输出里鲁棒地取出条目列表（容忍前后文字 / markdown 围栏） */
export function parseElementMelt(raw: string): MeltResult {
  const text = (raw ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) {
    // 也可能是单个对象
    return parseElementMelt('[' + text + ']')
  }
  try {
    const arr = JSON.parse(text.slice(start, end + 1)) as unknown[]
    const elements: MeltElement[] = []
    for (const x of arr) {
      if (!x || typeof x !== 'object') continue
      const o = x as Record<string, unknown>
      const kind = String(o.kind ?? 'lore')
      const name = String(o.name ?? '').trim()
      if (!name) continue
      elements.push({
        kind: ['rule', 'scene', 'prop', 'lore', 'other'].includes(kind) ? (kind as MeltElement['kind']) : 'lore',
        name: name.slice(0, 40),
        tags: Array.isArray(o.tags) ? o.tags.map(String).filter(Boolean).slice(0, 6) : [],
        content: String(o.content ?? o.desc ?? '').trim().slice(0, 2000)
      })
    }
    return { elements }
  } catch (e) {
    return { elements: [], error: '条目解析失败：' + (e as Error).message }
  }
}

/** 把解析出的条目物化成待确认草稿（targetId 用 new: 前缀，确认时创建条目） */
export function toCreateDrafts(elements: MeltElement[], atChapter: number, source: string): SweepDraft[] {
  const ts = Date.now()
  return elements.map((el, i) => {
    const body = JSON.stringify(el)
    return {
      id: 'melt_' + ts + '_' + i,
      targetType: 'element',
      targetId: 'new:' + i,
      targetName: '【新建条目】' + el.name,
      atChapter: Math.max(1, atChapter),
      draftContent: body,
      changeLog: '来自「' + source + '」的沉淀分解',
      status: 'pending'
    }
  })
}
