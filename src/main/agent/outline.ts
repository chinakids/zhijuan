// ===== 织卷 · 大纲回建（agent-first：把已有正文回建成章卡） =====
// 逐章跑写作引擎，把「已是事实的正文」回建成标准章卡（一句话定位 / 关键事件 / 人物进展 / 钩子），
// 落到 大纲/ 目录（每章一张 + 一本索引），让大纲区随正文进度活起来。
// 与 runAudit 同构：独立 session、无提问、离线出结果；写入走主进程 writeDoc（设定改动仍走提案制，章卡属于写作副产物，直写）。
import { readDoc, listChapters, listDocs, writeDoc } from '../store'
import { isOutlineCardRel, outlineCardDoc, outlineIndexDoc, parseOutlineCard } from '../../shared/outline'
import { registerCapability, runOnce, subtaskBlocked, stripFm, type SubtaskDef } from './subtask'
import type { ChapterEntry, OutlineCard } from '../../shared/types'

/** 章卡对应的落盘文件：大纲/<章节名>.md */
function outlineRel(c: ChapterEntry): string {
  return '大纲/' + c.file.replace(/^正文\//, '')
}

function cardSystem(): string {
  return (
    '你是织卷的「大纲回建师」。下面给出一章的正文全文。请把这一章「回建」成一张标准章卡——' +
    '也就是把它放进全书大纲时应该有的样子：\n' +
    '- oneLine：一句话定位——这一章在全书里干什么（推人物前进 / 埋线索 / 揭晓 / 转向…）；\n' +
    '- beats：关键事件，最多 5 条，每条一个动词短句；\n' +
    '- charProgress：主要人物在本章的状态变化，一两句话；\n' +
    '- hooks：本章新埋的钩子、或本章应当回应的旧钩子，最多 4 条。\n' +
    '要求：只根据本章正文判断，不要编造还没发生的事；正文若只是开头或被省略了中部，就按现有内容回建。\n' +
    '输出且只输出一个 JSON 对象（不要 markdown 围栏、不要任何前后缀文字）：' +
    '{"oneLine":"…","beats":[…],"charProgress":"…","hooks":[…]}'
  )
}

function extractCard(text: string): { oneLine: string; beats: string[]; charProgress: string; hooks: string[] } {
  const clean = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  let obj: any = null
  try {
    obj = JSON.parse(clean)
  } catch {}
  if (!obj) {
    const a = clean.indexOf('{')
    const b = clean.lastIndexOf('}')
    if (a >= 0 && b > a) {
      try {
        obj = JSON.parse(clean.slice(a, b + 1))
      } catch {}
    }
  }
  const arr = (v: any) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map(String).slice(0, 6) : [])
  return {
    oneLine: typeof obj?.oneLine === 'string' ? obj.oneLine : '',
    beats: arr(obj?.beats),
    charProgress: typeof obj?.charProgress === 'string' ? obj.charProgress : '',
    hooks: arr(obj?.hooks)
  }
}

/** 从已落盘的章卡文件回读成 OutlineCard（只回建缺失时，索引要把旧卡也并进去）；解析规则见 shared/outline（与索引重建同口径） */
function readCardFromDoc(projectId: string, rel: string): OutlineCard | null {
  const raw = readDoc(projectId, rel) ?? ''
  if (!raw.trim()) return null
  return parseOutlineCard(raw, rel)
}

export type OutlineRebuildResult =
  | { ok: true; cards: OutlineCard[]; written: string[] }
  | { ok: false; error: string }

/** 单章章卡任务：一轮驱动 + 解析（供循环复用） */
const cardDef: SubtaskDef<{ oneLine: string; beats: string[]; charProgress: string; hooks: string[] }> = {
  id: 'outline',
  title: '大纲回建',
  description: '把已有正文（逐章）回建成章卡，写 大纲/ 目录',
  maxMs: 5 * 60 * 1000,
  buildParts: (c) => {
    const rel = String(c.args?.chapterRel ?? '')
    const raw = readDoc(c.projectId, rel) ?? ''
    const body = stripFm(raw)
    if (!body.trim()) throw new Error('章节没有内容')
    return [cardSystem(), '【本章正文】\n' + body.slice(0, 24000)]
  },
  parse: (text) => extractCard(text)
}
registerCapability(cardDef as never)

let outSeq = 0

/** 回建章卡（可只回建指定的正文章节）；慢任务，由 IPC 呼叫方挂起等待 */
export async function runOutlineRebuild(
  projectId: string,
  opts?: { onProgress?: (msg: string) => void; only?: string[] }
): Promise<OutlineRebuildResult> {
  let chapters = listChapters(projectId).filter((c) => stripFm(readDoc(projectId, '正文/' + c.file) ?? '').trim())
  if (opts?.only?.length) {
    const want = new Set(opts.only.map((f) => f.replace(/^正文\//, '')))
    chapters = chapters.filter((c) => want.has(c.file))
  }
  if (!chapters.length) return { ok: false, error: '还没有可回建的正文章节。' }
  const blocked = subtaskBlocked('outline', '大纲回建')
  if (blocked) return { ok: false, error: blocked }
  const cards: OutlineCard[] = []
  const written: string[] = []
  try {
    for (const c of chapters) {
      opts?.onProgress?.(`正在回建「${c.name}」…`)
      const parsed = await runOnce(cardDef, {
        projectId,
        args: { chapterRel: '正文/' + c.file },
        seq: outSeq++
      })
      const card: OutlineCard = {
        file: '正文/' + c.file,
        no: c.fm?.['章号'],
        title: c.fm?.['题名'] ?? c.name,
        slice: c.fm?.['切片'] ?? '',
        ...parsed,
        wordCount: c.wordCount
      }
      const rel = outlineRel(c)
      writeDoc(projectId, rel, outlineCardDoc(card, '正文/' + c.file.replace(/^正文\//, '')))
      cards.push(card)
      written.push(rel)
    }
    // 索引：本次回建的卡 + 已有旧卡合并（只回建缺失时别把旧卡从索引里丢掉）
    const checked = new Set(cards.map((c) => c.file))
    for (const c of listChapters(projectId)) {
      const rf = '正文/' + c.file
      if (checked.has(rf)) continue
      const rel = outlineRel(c)
      const old = readCardFromDoc(projectId, rel)
      if (old) cards.push(old)
    }
    cards.sort((a, b) => (a.no ?? 1e9) - (b.no ?? 1e9))
    writeDoc(projectId, '大纲/索引.md', outlineIndexDoc(cards))
    return { ok: true, cards, written }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 300) }
  }
}

/** 大纲区已有章卡文件的相对路径清单（供 UI 判断哪些待回建；排除 索引/导演板/分幕/审读 副产物） */
export function listOutlineDocs(projectId: string): string[] {
  return listDocs(projectId, '大纲')
    .map((d) => '大纲/' + d.file)
    .filter(isOutlineCardRel)
}
