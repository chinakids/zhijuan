// 织卷 · 章节审计（sweeper）· 纯逻辑（无 Electron 依赖）
// 写完一章后：生成记录的解析、设定变化候选的推断、以及「接受草稿 → 落库」的应用。
// 原则：AI 从不直接改设定 —— 所有变化都要先成为草稿（SweepDraft），主人确认后才进时间线。
import { appendSlice } from './setting.ts'
import type { Project, Chapter, ChapterRecord, SweepDraft, Foreshadow, SettingSlice, Character, Element } from './types.ts'
import type { MeltElement } from './melt.ts'

export interface AuditParseResult {
  record: ChapterRecord | null
  error?: string
}

/** 从 LLM 原始输出里鲁棒地取出 JSON（允许前后有文字） */
export function parseAudit(raw: string): AuditParseResult {
  const text = (raw ?? '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return { record: null, error: '输出里找不到 JSON 对象' }
  }
  try {
    const obj = JSON.parse(text.slice(start, end + 1))
    const record: ChapterRecord = {
      chapterNum: Number(obj.chapterNum) || 0,
      summary: String(obj.summary ?? '').trim(),
      characterStates: Array.isArray(obj.characterStates)
        ? obj.characterStates
            .filter((x: unknown) => x && typeof x === 'object')
            .map((x: { name?: unknown; state?: unknown }) => ({
              charId: String(x.name ?? '').trim(),
              state: String(x.state ?? '').trim()
            }))
            .filter((x: { charId: string; state: string }) => x.charId && x.state)
        : [],
      resolved: Array.isArray(obj.resolved) ? obj.resolved.map(String).filter(Boolean) : [],
      sown: Array.isArray(obj.sown) ? obj.sown.map(String).filter(Boolean) : [],
      standingChanges: Array.isArray(obj.standingChanges) ? obj.standingChanges.map(String).filter(Boolean) : []
    }
    return { record }
  } catch (e) {
    return { record: null, error: 'JSON 解析失败：' + (e as Error).message }
  }
}

/** 一个拟议中的设定变化（会转成 SweepDraft 供主人确认） */
interface ProposedChange {
  targetType: 'character' | 'element'
  targetId: string
  targetName: string
  atChapter: number
  draftContent: string
  changeLog: string
}

/**
 * 依据本章记录，推断把哪些「变化」转成草稿：
 * - 每个有状态变化的人物 → 一个拟议新切片（在原有现状上追加变化），只要它和最近切片有实质差别
 * - standingChanges 只进记录展示，不自动改设定（避免 AI 越权），可以通过手动打点来改
 */
export function inferChangeCandidates(project: Project, record: ChapterRecord | null): ProposedChange[] {
  if (!record) return []
  const out: ProposedChange[] = []
  const seen = new Set<string>()
  for (const cs of record.characterStates) {
    // charId 这里暂存的是姓名字符串（详见 parseAudit）
    const char = (project.characters ?? []).find((c) => c.name === cs.charId)
    if (!char) continue
    if (seen.has(char.id)) continue
    const slices = char.slices ?? []
    const last = slices.length ? slices[slices.length - 1] : null
    const state = cs.state.trim()
    if (!state || state.length < 4) continue
    // 跟「到本章为止」的最新切片比：如果这段状态已包含其中，说明没变化
    if (last && last.content.includes(state)) continue
    const base = last?.content || ''
    const draftContent = (base ? base + '\n' : '') + '（本章后）' + state
    out.push({
      targetType: 'character',
      targetId: char.id,
      targetName: char.name,
      atChapter: record.chapterNum,
      draftContent: draftContent.slice(0, 1200),
      changeLog: `第${record.chapterNum}章后：` + state.slice(0, 50)
    })
    seen.add(char.id)
  }
  return out
}

/** 把「拟议变化」物化成待确认草稿（连同章节记录本身作为一个特殊草稿，让确认动作统一） */
export function toSweepDrafts(
  project: Project,
  chapter: Chapter,
  record: ChapterRecord | null,
  changes: ProposedChange[]
): SweepDraft[] {
  const drafts: SweepDraft[] = []
  const ts = Date.now()
  if (record) {
    drafts.push({
      id: 'sw_' + ts + '_r',
      targetType: 'character', // record 借用 character 位，但用特殊名称标明
      targetId: 'record:' + record.chapterNum,
      targetName: `第${record.chapterNum}章 × 章节记录`,
      atChapter: record.chapterNum,
      draftContent: JSON.stringify(record),
      changeLog: '章节审计记录（含摘要/状态/伏笔变化）',
      status: 'pending'
    })
  }
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]
    drafts.push({
      id: 'sw_' + ts + '_' + i,
      targetType: c.targetType,
      targetId: c.targetId,
      targetName: c.targetName,
      atChapter: c.atChapter,
      draftContent: c.draftContent,
      changeLog: c.changeLog,
      status: 'pending'
    })
  }
  return drafts
}

function isRecordDraft(d: SweepDraft): boolean {
  return d.targetId.startsWith('record:')
}

/** 由记录里的 sown / resolved 同步伏笔台账（只在接受章节记录草稿时执行） */
export function syncForeshadows(project: Project, record: ChapterRecord): Foreshadow[] {
  const fh = [...(project.foreshadows ?? [])]
  for (const desc of record.sown) {
    if (!desc) continue
    if (fh.some((f) => f.desc === desc)) continue
    fh.push({
      id: 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      desc,
      sownChapter: record.chapterNum,
      status: 'open'
    })
  }
  for (const desc of record.resolved) {
    for (const f of fh) {
      if (f.status === 'open' && (f.desc === desc || f.desc.includes(desc) || desc.includes(f.desc))) {
        f.status = 'resolved'
        f.resolvedChapter = record.chapterNum
      }
    }
  }
  return fh
}

/** 接受一批草稿 → 就地写回（返回新的 snapshots 供外部赋值到 project） */
export interface ApplyResult {
  characters: Character[]
  elements: Element[]
  records: ChapterRecord[]
  foreshadows: Foreshadow[]
  drafts: SweepDraft[]
}

/**
 * 接受 str（status=pending 的草稿们）中的 id 列表：
 * - 章节记录草稿 → 写进 project.records（同章替换）并同步伏笔
 * - 人物切片草稿 → 给该人物时间线追加一个 sweep 切片
 * 返回需要整体替换的字段（调用方负责装配新 project）
 */
export function applySweeps(
  project: Project,
  acceptIds: string[]
): ApplyResult {
  const accept = new Set(acceptIds)
  const records = [...(project.records ?? [])]
  let foreshadows = [...(project.foreshadows ?? [])]
  const charMap = new Map((project.characters ?? []).map((c) => [c.id, { ...c }]))
  const elemMap = new Map((project.elements ?? []).map((e) => [e.id, { ...e }]))
  const ts = Date.now()
  const drafts = (project.sweepDrafts ?? []).map((d) => {
    if (!accept.has(d.id)) return d
    if (d.status === 'rejected') return d
    if (isRecordDraft(d)) {
      try {
        const rec = JSON.parse(d.draftContent) as ChapterRecord
        const idx = records.findIndex((r) => r.chapterNum === rec.chapterNum)
        if (idx >= 0) records[idx] = rec
        else records.push(rec)
        foreshadows = syncForeshadows({ ...project, foreshadows, records }, rec)
      } catch {
        /* 记录解析失败则跳过 */
      }
    } else if (d.targetType === 'element' && d.targetId.startsWith('new:')) {
      // 沉淀为条目：确认后真正创建新条目
      try {
        const me = JSON.parse(d.draftContent) as MeltElement
        if (me && me.name) {
          const el: Element = {
            id: 'e_' + ts.toString(36) + Math.random().toString(36).slice(2, 6),
            kind: me.kind ?? 'lore',
            name: me.name,
            tags: me.tags ?? [],
            active: true,
            slices: [{ atChapter: Math.max(1, d.atChapter), content: me.content || '', source: 'initial', confirmed: true }],
            createdAt: ts,
            updatedAt: ts
          }
          elemMap.set(el.id, el)
        }
      } catch {
        /* 跳过 */
      }
    } else if (d.targetType === 'element') {
      const e = elemMap.get(d.targetId)
      if (e) {
        e.slices = appendSlice(e.slices ?? [], {
          atChapter: Math.max(1, d.atChapter),
          content: d.draftContent,
          changeLog: d.changeLog,
          source: 'sweep' as const,
          confirmed: true
        })
        elemMap.set(e.id, e)
      }
    } else {
      const c = charMap.get(d.targetId)
      if (c) {
        const slice: SettingSlice = {
          atChapter: Math.max(1, d.atChapter),
          content: d.draftContent,
          changeLog: d.changeLog,
          source: 'sweep',
          confirmed: true
        }
        c.slices = appendSlice(c.slices ?? [], slice)
        charMap.set(c.id, c)
      }
    }
    return { ...d, status: 'accepted' as const }
  })
  return {
    characters: [...charMap.values()],
    elements: [...elemMap.values()],
    records,
    foreshadows,
    drafts
  }
}

/** 拒绝一批草稿（保持 pending 供后续变化时可回看，但标记下来） */
export function rejectSweeps(project: Project, ids: string[]): SweepDraft[] {
  const set = new Set(ids)
  return (project.sweepDrafts ?? []).map((d) => (set.has(d.id) ? { ...d, status: 'rejected' as const } : d))
}
