// 织卷 · 设定时间线 · 纯逻辑（无 Electron 依赖，可被主进程与测试脚本共用）
// 核心目标：生成时永远只取「到本章为止」的最新切片 —— 从机制上杜绝啃书啃错。
import type { Character, Element, Project, SettingSlice } from './types'

/** 把人物当前字段拼成一段可存档的快照文本（生成时也以此为准） */
export function charSnapshot(c: Character): string {
  const parts: string[] = []
  if (c.tags?.length) parts.push('标签: ' + c.tags.join('、'))
  if (c.background) parts.push('身世: ' + c.background)
  if (c.relation) parts.push('与主角关系: ' + c.relation)
  for (const f of c.fields ?? []) {
    if (typeof f.key === 'string' && f.key.trim()) parts.push(f.key + ': ' + f.value)
  }
  return parts.join('\n')
}

export function initialSlice(c: Character): SettingSlice {
  return { atChapter: 1, content: charSnapshot(c), source: 'initial', confirmed: true }
}

/** 取「到第 ch 章为止」最新有效的切片（时间旅行查询；ch 超过最大章时为最新） */
export function sliceAt(slices: SettingSlice[], ch: number): SettingSlice | null {
  if (!Array.isArray(slices) || slices.length === 0) return null
  const valid = slices.filter((s) => s.atChapter <= ch)
  return valid.length ? valid[valid.length - 1] : null
}

/** 该设定在时间线上「未来」（比当前章更晚）的所有切片 —— 这些绝不能在本次生成里出现 */
export function futureSlices(slices: SettingSlice[], ch: number): SettingSlice[] {
  if (!Array.isArray(slices)) return []
  return slices.filter((s) => s.atChapter > ch)
}

/** 当前章节进度（最大的章节号），用于给新切片定生效章位 */
export function currentChapter(p: Project): number {
  return (p.chapters ?? []).reduce((m, c) => Math.max(m, c.num || 0), 0)
}

/** 归一化：兼容旧 JSON，并保证「人物当前字段 = 时间线最后切片」的一致 */
export function normalizeProject(p: Project): Project {
  p.worldview = p.worldview ?? { name: '', city: '', era: '', themes: [], rules: [], background: '' }
  p.chapters = p.chapters ?? []
  p.elements = Array.isArray(p.elements) ? p.elements : []
  p.records = Array.isArray(p.records) ? p.records : []
  p.foreshadows = Array.isArray(p.foreshadows) ? p.foreshadows : []
  p.sweepDrafts = Array.isArray(p.sweepDrafts) ? p.sweepDrafts : []

  p.characters = (p.characters ?? []).map((c) => {
    c.tags = Array.isArray(c.tags) ? c.tags : []
    c.fields = Array.isArray(c.fields) ? c.fields : []
    if (typeof c.active !== 'boolean') c.active = true
    const snap = charSnapshot(c)
    if (!Array.isArray(c.slices) || c.slices.length === 0) {
      c.slices = [initialSlice(c)] // 旧数据：把当前设定固化为初始切片
    } else {
      // 让最后切片始终等于「当前字段」（随手改的都是即时生效的最新值，不堆历史；
      // 历史切片只在「章节审计 sweep」或「手动打点」时追加）
      const last = c.slices[c.slices.length - 1]
      if (last.content !== snap) {
        c.slices = [...c.slices.slice(0, -1), { ...last, content: snap, changeLog: last.changeLog ?? undefined }]
      }
    }
    return c
  })

  // M2.2：旧章节没有 acts 时把 content 折成整幕，保证「回滚到某幕」的入口恒在
  p.chapters = (p.chapters ?? []).map((c) => {
    if (!Array.isArray(c.acts) || c.acts.length === 0) {
      c.acts = c.content ? [c.content] : []
    }
    return c
  })
  return p
}

/** 给条目时间线追加一个切片（按章有序） */
export function appendSlice(
  slices: SettingSlice[],
  next: SettingSlice
): SettingSlice[] {
  return [...(Array.isArray(slices) ? slices : []), next].sort((a, b) => a.atChapter - b.atChapter)
}

/** 把 Element 在某一章时刻对外的「可读快照」取出来（供组配器使用） */
export function elementAt(el: Element, ch: number): SettingSlice | null {
  if (!el.active) return null
  return sliceAt(el.slices, ch)
}
