// ===== 织卷 · 导演板逆解析（纯约定，无 fs，可单测） =====
// 导演板 = 大纲/<章>_导演.md（写作副产物，由 directorToDoc 生成）。本模块把它按约定格式
// 反解回结构化 DirectorSheet，让「分幕生成」等消费方直接拿分段做事，而不必再让模型自己解析原文。
// 解析按章节标题分节、先去 ** 加粗再做行匹配（粗体只是样式，不影响内容）；容错：
// 有序号（1.）或列表符（-）均可、冒号中英混用；解析不到的部分给空值，由调用方决定回退。
import type { DirectorSheet } from './types'

const TASKS = new Set(['推进', '白热化', '拉锯', '低谷'])
const LEVELS = new Set(['被压', '试探', '放开'])

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** 把导演板 markdown（可带 front matter）反解回结构化导演板 */
export function parseDirectorSheet(md: string): DirectorSheet {
  const out: DirectorSheet = {
    premise: '',
    arcs: [],
    climax: { at: 1, idea: '' },
    axes: [],
    redlines: [],
    hooks: []
  }
  if (!md) return out
  // 剥约定头
  const body = md.replace(/^---\n[\s\S]*?\n---\s*(\n|$)/, '')
  let section = ''
  const classify = (name: string): string => {
    if (name.includes('情绪弧')) return 'arcs'
    if (name.includes('波峰')) return 'climax'
    if (name.includes('行为轴')) return 'axes'
    if (name.includes('写作红线')) return 'redlines'
    if (name.includes('钩子')) return 'hooks'
    if (name.includes('戏剧任务')) return 'premise'
    return ''
  }
  for (const raw of body.split('\n')) {
    const line0 = raw.trim()
    if (!line0) continue
    const m = line0.match(/^#{1,6}\s+(.+)$/)
    if (m) {
      section = classify(m[1])
      continue
    }
    // 粗体只是 markdown 样式，先剥掉再匹配内容
    const line = line0.replace(/\*+/g, '')
    if (section === 'arcs') {
      const am = line.match(/^(?:\d+\.|[-*])\s*([^：:]+)\s*[：:]\s*(.+)$/)
      if (am) {
        const task = am[1].trim()
        const goal = am[2].trim()
        if (TASKS.has(task) && goal) {
          out.arcs.push({ task: task as DirectorSheet['arcs'][number]['task'], goal: goal.slice(0, 120) })
        }
      }
      continue
    }
    if (section === 'climax') {
      const cm = line.match(/^第\s*(\d+)\s*段/)
      if (cm) {
        out.climax.at = Math.max(1, Number(cm[1]))
        const idea = line.replace(/^第\s*\d+\s*段\s*[·\-:：]?\s*/, '').trim()
        if (idea && idea !== '（待定）') out.climax.idea = idea.slice(0, 200)
      } else {
        const idea = str(line)
        if (idea && idea !== '（待定）') out.climax.idea = idea.slice(0, 200)
      }
      continue
    }
    if (section === 'axes') {
      const ax = line.match(/^[-*]\s*([^（(：:]+)（([^）)]+)）\s*[：:]\s*(.+)$/)
      if (ax) {
        const character = ax[1].trim()
        const level = ax[2].trim()
        const al = ax[3].trim()
        if (character && LEVELS.has(level)) {
          out.axes.push({ character, level: level as DirectorSheet['axes'][number]['level'], line: al.slice(0, 120) })
        }
      }
      continue
    }
    if (section === 'redlines' || section === 'hooks') {
      const li = line.match(/^[-*]\s+(.+)$/)
      if (li) {
        const item = str(li[1])
        if (item && item !== '（待定）') {
          if (section === 'redlines' && out.redlines.length < 5) out.redlines.push(item.slice(0, 100))
          else if (section === 'hooks' && out.hooks.length < 3) out.hooks.push(item.slice(0, 100))
        }
      }
      continue
    }
    if (section === 'premise' && !out.premise) {
      const p = str(line)
      if (p && p !== '（待定）') out.premise = p.slice(0, 300)
    }
  }
  // 条数上限 + 波峰段号钳到 arcs 范围内
  out.arcs = out.arcs.slice(0, 5)
  out.axes = out.axes.slice(0, 8)
  if (out.arcs.length) out.climax.at = Math.max(1, Math.min(out.arcs.length, out.climax.at))
  return out
}
