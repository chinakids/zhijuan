// ===== 织卷 · 批注定时优化（主人 2026-09-12 拍板；模块设计 §11之 新增检查器） =====
// 对齐主人既有批注流程（批注任务脚本.py）：项目内 正文/**/*_批注.csv（<名>_批注.csv ↔ <名>.md 同目录，无表头，
// 每行「L<行>:<列>-L<行>:<列>,批注意图」）。织卷侧：扫描 → 定位文段 → 写作引擎按意图产出改写 →
// 生成修改提案（source=annotation-sync，走提案制确认；同章 pending 置 stale 与 slice-sync 同口径）→
// 提案被接受/拒绝后删除对应 csv 行（空 csv 删除文件）——与脚本 remove/cull 语义一致。
// 「定时」= 打开项目后 30s 起跑 + 每 30 分钟 + 提案抽屉手动按钮（渲染侧触发本模块 scan）。
import { readdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync, mkdirSync } from 'fs'
import { join, relative, dirname } from 'path'
import { projectDir } from '../store'
import { libraryRoot } from '../settings'
import { createProposals } from '../proposals'
import { parseAnnotationCsv, segmentFromText, escapeCsvField } from '../../shared/annotations'
import { registerCapability, runSubtask, extractJson, type SubtaskDef } from './subtask'
import type { Proposal, ProposalItem, AnnotationRef } from '../../shared/types'

/** 记账：<项目>/.zhijuan/annotations.done.json —— 已生成提案的（csvRel → 行号），防定时重复生成 */
type DoneState = Record<string, { mtimeMs: number; rows: number[] }>

function loadDone(root: string): DoneState {
  try {
    return JSON.parse(readFileSync(join(root, '.zhijuan', 'annotations.done.json'), 'utf-8'))
  } catch {
    return {}
  }
}

function saveDone(root: string, done: DoneState): void {
  try {
    writeFileSync(join(root, '.zhijuan', 'annotations.done.json'), JSON.stringify(done), 'utf-8')
  } catch {
    /* 记账失败不致命：最坏重复生成一次 */
  }
}

export interface AnnotationTarget {
  csvRel: string
  mdRel: string
  row: number
  loc: string
  note: string
  before: string
}

/** 扫描项目内「正文」目录下所有 *_批注.csv → 未处理的定位成功目标（跳过：已记账行、定位失败行、md 缺失） */
export function findAnnotationTargets(projectId: string): AnnotationTarget[] {
  const root = projectDir(projectId)
  const done = loadDone(root)
  const out: AnnotationTarget[] = []
  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!e.name.startsWith('.')) walk(full)
        continue
      }
      if (!e.name.endsWith('_批注.csv')) continue
      const csvRel = relative(root, full).split('\\').join('/')
      const mdRel = csvRel.replace(/_批注\.csv$/, '.md')
      const mdAbs = join(root, mdRel)
      if (!existsSync(mdAbs)) continue
      let mdText: string
      try {
        mdText = readFileSync(mdAbs, 'utf-8')
      } catch {
        continue
      }
      const st = statSync(full)
      const rec = done[csvRel]
      const doneRows = rec && st.mtimeMs <= rec.mtimeMs ? rec.rows : []
      const rows = parseAnnotationCsv(readFileSync(full, 'utf-8'))
      rows.forEach((r, i) => {
        if ((!r.loc && !r.before) || doneRows.includes(i + 1)) return
        // 定位优先级：csv 第 3 列「原文」精确匹配（编辑器划词写入）> loc 行列区间
        const before = r.before && mdText.includes(r.before) ? r.before : segmentFromText(mdText, r.loc)
        if (before == null) return
        out.push({ csvRel, mdRel, row: i + 1, loc: r.loc, note: r.note, before })
      })
    }
  }
  walk(join(root, '正文'))
  return out
}

/** 提案被应用/拒绝后删除其引用的 csv 行（空 csv 删文件）——与批注脚本 remove/cull 同语义。返回删除行数 */
export function resolveAnnotationRows(projectId: string, refs: AnnotationRef[] | undefined): number {
  if (!refs?.length) return 0
  const root = projectDir(projectId)
  let n = 0
  for (const ref of refs) {
    const abs = join(root, ref.file)
    if (!existsSync(abs)) continue
    let lines: string[]
    try {
      lines = readFileSync(abs, 'utf-8').replace(/\n$/, '').split('\n')
    } catch {
      continue
    }
    for (const r of [...ref.rows].sort((a, b) => b - a)) {
      if (r >= 1 && r <= lines.length) {
        lines.splice(r - 1, 1)
        n++
      }
    }
    if (!lines.join('\n').trim()) {
      try {
        rmSync(abs)
      } catch {
        /* 忽略 */
      }
    } else {
      try {
        writeFileSync(abs, lines.join('\n') + '\n', 'utf-8')
      } catch {
        /* 忽略 */
      }
    }
  }
  // 行已物理删除：对应记账记录一并清理
  const done = loadDone(root)
  for (const ref of refs) delete done[ref.file]
  saveDone(root, done)
  return n
}

/** 编辑器划词写入批注（追加到 <md 同名>_批注.csv；loc 尽力而为（同行），before=选中原文，定位兜底） */
export function addAnnotation(
  projectId: string,
  mdRel: string,
  entry: { loc: string; before: string; note: string }
): { csvRel: string; row: number; ok: boolean } {
  const root = projectDir(projectId)
  const mdNorm = mdRel.endsWith('.md') ? mdRel : mdRel + '.md'
  const csvRel = mdNorm.replace(/\.md$/, '') + '_批注.csv'
  const abs = join(root, csvRel)
  let existing = ''
  try {
    existing = readFileSync(abs, 'utf-8')
  } catch {
    /* 文件不存在 */
  }
  const body = existing.replace(/\n$/, '')
  const line = `${escapeCsvField(entry.loc)},${escapeCsvField(entry.note)},${escapeCsvField(entry.before)}`
  try {
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, (body ? body + '\n' : '') + line + '\n', 'utf-8')
  } catch {
    return { csvRel, row: 0, ok: false }
  }
  const rows = parseAnnotationCsv(readFileSync(abs, 'utf-8'))
  return { csvRel, row: rows.length, ok: true }
}

const annotationDef: SubtaskDef<{ before: string; after: string; reason: string }[]> = {
  id: 'annotation-sync',
  title: '批注改写引擎',
  description: '按批注意图产出正文改写（定时/手动扫描批注时调用；配合设置页「批注定时优化」开关使用）',
  buildParts: async (ctx) => {
    const targets = (ctx.args?.targets ?? []) as AnnotationTarget[]
    if (!targets.length) throw new Error('没有待处理批注')
    return [
      '你是长篇小说的修改助手。以下是正文的批注列表（每条：位置、批注意图、原文文段）。',
      '请逐条按「批注意图」产出改写后的文段：只做批注明示的改动；保持人物口吻与段落语气；',
      '不解释、不改动未批注的部分；输出 JSON 数组（按原顺序）：[{"before":"与原文完全一致","after":"改写后的文段","reason":"一句话说明"}]。',
      targets.map((t, i) => `#${i + 1} ${t.loc}\n批注意图：${t.note}\n原文：${t.before}`).join('\n\n')
    ]
  },
  parse: (text) => extractJson<{ before: string; after: string; reason: string }[]>(text) ?? [],
  postprocess: (items) => items.filter((x) => typeof x?.after === 'string' && x.after.trim().length > 0)
}
registerCapability(annotationDef as never)

/** 定时/手动入口：扫描 → 模型改写 → 生成提案 + 记账 */
export async function scanAnnotations(
  projectId: string
): Promise<{ found: number; generated: number; skipped: number; note: string }> {
  const targets = findAnnotationTargets(projectId)
  if (!targets.length) return { found: 0, generated: 0, skipped: 0, note: '没有新的待处理批注' }
  const outcome = await runSubtask(annotationDef as never, projectId, { targets })
  if (!outcome.ok) return { found: targets.length, generated: 0, skipped: targets.length, note: outcome.error }
  const itemsBy = new Map<string, ProposalItem[]>()
  let matched = 0
  const result = outcome.result as { before: string; after: string; reason: string }[]
  for (const t of targets) {
    const hit = result.find((x) => x.before && x.before.trim() === t.before.trim())
    if (!hit) continue
    matched++
    const items = itemsBy.get(t.mdRel) ?? []
    items.push({
      target: t.mdRel,
      anchor: t.loc,
      kind: 'replace-text',
      before: t.before,
      after: hit.after,
      reason: (hit.reason || t.note || '来自批注') + '（批注同步）'
    })
    itemsBy.set(t.mdRel, items)
  }
  if (!itemsBy.size) return { found: targets.length, generated: 0, skipped: targets.length, note: '引擎未产出可用改写（批注未动，可稍后重试）' }
  const root = libraryRoot()
  // 按章节一次创建（同章单次调用，避免互相置 stale），但每条 item 只带自己的批注行号（接受/拒绝只删对应行）
  for (const [chapter, items] of itemsBy) {
    const metas: Proposal['meta'][] = []
    for (const it of items) {
      const t = targets.find((x) => x.mdRel === chapter && x.before === it.before)
      metas.push({ annotations: t ? [{ file: t.csvRel, rows: [t.row] }] : undefined })
    }
    createProposals(root, projectId, 'annotation-sync', chapter, '', items, undefined, metas)
  }
  // 记账（只记实际生成提案的批注行；csv 被改动时 mtime 变化 → 自动重扫；未匹配行不记账，保留到下一轮重试）
  const rootP = projectDir(projectId)
  const done = loadDone(rootP)
  const toRecord = new Map<string, number[]>()
  for (const t of targets) {
    const hit = result.find((x) => x.before && x.before.trim() === t.before.trim())
    if (!hit) continue
    const arr = toRecord.get(t.csvRel) ?? []
    arr.push(t.row)
    toRecord.set(t.csvRel, arr)
  }
  for (const [csvRel, rows] of toRecord) {
    const st = statSync(join(rootP, csvRel))
    const rec = done[csvRel] ?? { mtimeMs: st.mtimeMs, rows: [] }
    if (st.mtimeMs <= rec.mtimeMs) rec.rows.push(...rows)
    else rec.rows = rows
    done[csvRel] = rec
  }
  saveDone(rootP, done)
  return {
    found: targets.length,
    generated: itemsBy.size > 0 ? matched : 0,
    skipped: targets.length - matched,
    note: `发现 ${targets.length} 条批注，生成 ${matched} 条修改提案（未匹配 ${targets.length - matched} 条）`
  }
}
