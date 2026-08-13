// 织卷 · 曲线兑现检查（fulfill）· 纯逻辑（无 Electron 依赖）
// M2.4：本章生成后，把「正文 + 本章曲线契约」过一遍，标出曲线要求但正文没兑现的段落。
// 呼应创作规范里「写完要过自检」的习惯——曲线不是建议，是要被兑现的硬命令；
// 检查清单从导演板（含分幕）派生，保证「要求什么就查什么」；判定交给模型，
// 但清单构建、正文分块、行式协议解析、报告渲染都是可测的纯函数。
import type { Chapter, FulfillVerdict, FulfillReport } from './types.ts'
import { makeDirectorBoard, renderShotRow } from './director.ts'
import { pivotAxes } from './axes.ts'

/** 一条要检查的契约要求 */
export interface FulfillChecklistItem {
  id: string // 稳定 id（如 D3 / A-沈若汐·防线-5 / B-破门而入），模型按它回报
  kind: 'segment' | 'axis' | 'beat'
  seg?: number // 所属段号（若有）
  desc: string // 一条人话的要求描述（给主人看的短标签）
  requirement: string // 写进 prompt 的完整要求（模型据此核正文）
}

/** 检查清单（由本章曲线契约派生） */
export interface FulfillChecklist {
  items: FulfillChecklistItem[]
  source: 'board' | 'empty' // empty = 本章没有可用曲线，无需检查
}

/** 正文按块切分（供模型引用「块号」作为证据定位） */
export interface TextBlock {
  index: number // 1 起
  text: string
}

export const FULFILL = {
  blockChars: 500, // 正文每块约多少字（太细变成噪音，太粗没法定位）
  maxItems: 40, // 检查条目上限（条目太多时按优先级砍，保住段落契约）
  maxBlocks: 60, // 正文块数上限（超出后合并到末块）
  maxContentChars: 30000 // 送检正文上限（超出的按末块截断）
}

/** 从章曲线契约建造检查清单（无曲线返回 empty） */
export function buildFulfillChecklist(chapter: Chapter): FulfillChecklist {
  const curves = Array.isArray(chapter.curves) ? chapter.curves : []
  const beats = Array.isArray(chapter.beats) ? chapter.beats : []
  const hasCurve = curves.some((c) => (c.points ?? []).length > 1)
  if (!hasCurve) return { items: [], source: 'empty' }

  const plans = makeDirectorBoard(curves, beats)
  const items: FulfillChecklistItem[] = []

  // 1) 段落任务（导演板的硬命令）：一段一条
  for (const p of plans) {
    items.push({
      id: `D${p.seg}`,
      kind: 'segment',
      seg: p.seg,
      desc: `段${p.seg}的戏剧任务必须兑现（波峰/低谷/落差都要有相应事件支撑）`,
      requirement: renderShotRow(p)
    })
  }

  // 2) 人物行为轴：每根行为轴曲线在各段的档位要求各列一条
  for (const c of curves) {
    if (c.kind !== 'character') continue
    const axs = pivotAxes(c)
    if (axs.length === 0) continue
    for (const a of axs) {
      for (const p of plans) {
        const cv = p.curves.find((x) => x.name === c.name)
        const act = cv?.acts?.find((ac) => ac.name === a.name)
        if (!act) continue
        items.push({
          id: `A-${c.name}-${a.name}-${p.seg}`,
          kind: 'axis',
          seg: p.seg,
          desc: `人物「${c.name}」行为轴「${a.name}」在段${p.seg}要按「${act.band}」档来写`,
          requirement: `人物「${c.name}」在段${p.seg}（进度 ${p.fromPct}%-${p.toPct}%）应按行为轴「${a.name}」的「${act.band}」档动作来写：${act.demand}${act.shift ? '（本段相对上一段档位跳变，必须用具体事件承接）' : ''}`
        })
      }
    }
  }

  // 3) 情节点：到点必须落
  for (const b of beats) {
    const seg = plans.find((p) => b.at >= p.fromPct && b.at < p.toPct)
    items.push({
      id: `B-${b.label}`,
      kind: 'beat',
      seg: seg?.seg,
      desc: `情节点「${b.label}」要在对应位置落实`,
      requirement: `情节点「${b.label}」应在进度 ${b.at}% 附近落实（关键动作或视觉要写出来）：${b.note || '（无补充说明）'}`
    })
  }

  // 预算硬控：条目多时按 段任务 > 情节点 > 行为轴 的顺序砍到上限
  let out = items
  if (out.length > FULFILL.maxItems) {
    const prio: Record<FulfillChecklistItem['kind'], number> = { segment: 0, beat: 1, axis: 2 }
    out = [...items].sort((a, b) => prio[a.kind] - prio[b.kind]).slice(0, FULFILL.maxItems)
    out.sort((a, b) => (a.seg ?? 0) - (b.seg ?? 0) || a.id.localeCompare(b.id))
  }
  return { items: out, source: 'board' }
}

/** 把正文切成带编号的块（供模型引用块号作证据；末块可跨长） */
export function segmentText(content: string, blockChars: number = FULFILL.blockChars): TextBlock[] {
  const text = (content ?? '').trim()
  if (!text) return []
  const blocks: TextBlock[] = []
  let start = 0
  let idx = 1
  while (start < text.length && blocks.length < FULFILL.maxBlocks) {
    let end = Math.min(start + blockChars, text.length)
    if (blocks.length === FULFILL.maxBlocks - 1) end = text.length // 末块吸收剩余
    blocks.push({ index: idx++, text: text.slice(start, end) })
    start = end
  }
  return blocks
}

/** 把一个判定词（含 emoji 前缀）归一到结果 */
function normResult(raw: string): FulfillVerdict['result'] | null {
  const s = (raw ?? '').replace(/[✅✔☑️❌⚠️⛔️]/g, '').trim()
  if (s.includes('未兑现') || s.includes('未达成') || s.includes('未落实')) return 'miss'
  if (s.includes('部分')) return 'partial'
  if (s.includes('已兑现') || s.includes('达成') || s.includes('落实') || s.includes('兑现')) return 'met'
  return null
}

/** 解析模型回报（行式协议：`id: 已兑现|部分兑现|未兑现 — 块号,块号: 理由`），对照清单归一 */
export function parseFulfillReport(raw: string, checklist: FulfillChecklist): FulfillReport {
  const byId = new Map(checklist.items.map((i) => [i.id, i]))
  const verdicts: FulfillVerdict[] = []
  const seen = new Set<string>()
  const lines = String(raw ?? '').split(/\r?\n/)
  for (const line of lines) {
    // 1) 去行首 emoji / 空白；第一个「:」前是条目 id（可含中文/序号）
    const clean = line.replace(/^\s*(?:[✅✔☑️❌⚠️⛔️⭕]\s*)+/, '')
    const ci = clean.search(/[:：]/)
    if (ci < 0) continue
    const id = clean.slice(0, ci).trim()
    if (!byId.has(id) || seen.has(id)) continue
    const am = clean.slice(ci + 1).match(/^\s*(已兑现|部分兑现|未兑现)(?:\s*(?:—|–|-|：)\s*)?(.*)$/)
    if (!am) continue
    // 2) 剩余部分拆「块号…: 理由」，拆不出就当整段是理由
    const rest = (am[2] ?? '').trim()
    let blocks = ''
    let note = rest
    const bm = rest.match(/^(?:块\s*)?(\d[\d,，、\s]*)\s*[:：]?\s*(.*)$/)
    if (bm) {
      blocks = bm[1].replace(/[，、\s]/g, ',')
      note = bm[2]
    }
    seen.add(id)
    verdicts.push({ id, result: am[1] === '部分兑现' ? 'partial' : am[1] === '未兑现' ? 'miss' : 'met', blocks, note: note || rest })
  }
  // 清单里有但模型没报的 → unknown
  for (const item of checklist.items) {
    if (!seen.has(item.id)) {
      verdicts.push({ id: item.id, result: 'unknown', blocks: '', note: '模型未回报该条' })
    }
  }
  return buildFulfillReport(verdicts)
}

/** 由逐条判定汇总成报告（纯函数，供 parse 与手动录入共用） */
export function buildFulfillReport(verdicts: FulfillVerdict[]): FulfillReport {
  const v = Array.isArray(verdicts) ? verdicts : []
  return {
    checkedAt: Date.now(),
    total: v.length,
    met: v.filter((x) => x.result === 'met').length,
    partial: v.filter((x) => x.result === 'partial').length,
    miss: v.filter((x) => x.result === 'miss').length,
    unknown: v.filter((x) => x.result === 'unknown').length,
    verdicts: v,
    raw: ''
  }
}

const RESULT_ICON: Record<FulfillVerdict['result'], string> = {
  met: '✅',
  partial: '⚠️',
  miss: '❌',
  unknown: '➖'
}

/** 把检查清单做成模型要读的协议（正文分块 + 条目清单） */
export function renderFulfillPrompt(
  projectName: string,
  chapterNum: number,
  chapterTitle: string,
  checklist: FulfillChecklist,
  blocks: TextBlock[]
): string {
  const itemRows = checklist.items
    .map((i) => `- ${i.id}（${i.desc}）：${i.requirement}`)
    .join('\n')
  const body = blocks.map((b) => `【正文块${b.index}】\n${b.text}`).join('\n\n')
  return `你是《${projectName}》第${chapterNum}章「${chapterTitle}」的审稿人。本章写作前有明确的导演曲线契约，现在要核对正文是否兑现了每一条。
请客观判断，不要迁就：没写够就是没写够。

第一步，也是最优先的一步：一次性输出所有契约条目的回报行（格式见下），把它们放在最前面。所有回报行输出完之后，才允许写任何解释、总结或分析。

【需要核对的契约条目】（每条的 id 就是你回报时的依据）
${itemRows}

【本章正文】（已按块编号，判断证据时请指出块号）
${body}

回报行格式（一行一条，这是最重要的要求，必须全部在开头顶格依次列出）：
<条目id>: <判定> — 块号,块号: 理由
判定只能是：已兑现 / 部分兑现 / 未兑现（不要用别的词，不要加评价前缀）
块号：支撑你判断的正文块号（数字，可多个用逗号）；判断不了就写 0
理由：一句话直白说明，未兑现或部分兑现必须给出具体缺了什么、在哪一块。
示例：D3: 未兑现 — 3,4: 该有的动作没有写出来，只有内心戏
必须每一条都回报，不要省略。

返回值要求：先列全部回报行，然后另起一行写出“### 总评”，后面可以跟一段自由解释。除此之外不要输出任何标题或多余文字。`
}

/** 渲染成主人可读的报告（未兑现最优先、其次部分，块号供回正文定位） */
export function renderFulfillReport(projectName: string, chapter: Chapter, checklist: FulfillChecklist, report: FulfillReport): string {
  const head =
    `《${projectName}》第${chapter.num}章「${chapter.title}」 曲线兑现检查（M2.4）\n` +
    `共 ${report.total} 条契约：✅ 已兑现 ${report.met} · ⚠️ 部分 ${report.partial} · ❌ 未兑现 ${report.miss}${report.unknown ? ` · ➖ 未判定 ${report.unknown}` : ''}\n`
  if (report.miss === 0 && report.partial === 0 && report.unknown === 0) {
    return head + '\n本章曲线契约全部兑现，正文按导演板走了。🎉\n'
  }
  const byId = new Map(checklist.items.map((i) => [i.id, i]))
  const row = (v: FulfillVerdict) => {
    const item = byId.get(v.id)
    return (
      `${RESULT_ICON[v.result]} ${v.id}｜${item?.desc ?? '（清单外）'}\n` +
      `   要求：${item?.requirement ?? ''}\n` +
      `   ${v.result === 'miss' ? '未兑现' : v.result === 'partial' ? '部分兑现' : '未判定'}${v.blocks && v.blocks !== '0' ? `（正文块 ${v.blocks}）` : ''}：${v.note || '（无说明）'}\n`
    )
  }
  const parts: string[] = [head]
  const miss = report.verdicts.filter((v) => v.result === 'miss')
  const partial = report.verdicts.filter((v) => v.result === 'partial')
  const unknown = report.verdicts.filter((v) => v.result === 'unknown')
  if (miss.length) parts.push('## 未兑现（需要补写或解释）\n' + miss.map(row).join(''))
  if (partial.length) parts.push('## 部分兑现（可以加把劲）\n' + partial.map(row).join(''))
  if (unknown.length) parts.push('## 未判定（模型没核上，可重跑）\n' + unknown.map(row).join(''))
  return parts.join('\n')
}
