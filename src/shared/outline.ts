// ===== 织卷 · 大纲（章卡/索引）纯逻辑 =====
// 章卡生成 / 章卡解析 / 索引生成 / 章卡文件判据：全部为纯函数（不碰 fs、不依赖 store），
// 真机（main/agent/outline.ts 回建）、删除章后的索引重建（main/store.ts）与渲染层
// devShim（无头冒烟）共用同一套口径——避免「无头 mock 与真机不一致」假绿（2026-09-12 创作层）。
import type { OutlineCard } from './types'
import { setFrontMatterField } from './fmatter'
import { DEFAULT_LINE } from './line'

/**
 * 章卡文件判据：排除 索引.md、<章>_导演.md、<章>_分幕.md、审读_*.md 等写作副产物与 dot 文件。
 * rel 可为相对项目根（大纲/第01章_雾港.md）或相对大纲目录（第01章_雾港.md）。
 * 口径与大纲页左栏「已回建」计数过滤一致（Outline.tsx）。
 */
export function isOutlineCardRel(rel: string): boolean {
  const base = (rel.split('/').pop() ?? '').replace(/\.md$/, '')
  if (!base || base.startsWith('.')) return false
  if (base === '索引') return false
  if (base.startsWith('审读_')) return false
  if (base.endsWith('_导演') || base.endsWith('_分幕')) return false
  return true
}

/** 章卡 → 大纲/<章名>.md 文档（约定头 + 标准小节；章卡属写作副产物，直写，不走提案制）。
 * 「时间线」字段与正文/建章向导同口径：非主线才写，不写=主线（缺省零冗余，2026-09-17 多线透传）。 */
export function outlineCardDoc(c: OutlineCard, chapterRel: string): string {
  const lineRow = c.line && c.line !== DEFAULT_LINE ? `时间线: ${c.line}\n` : ''
  const fm =
    c.no !== undefined
      ? `---\n章号: ${c.no}\n题名: ${c.title}\n${lineRow}切片: ${c.slice}\n状态: 已回建\n---\n`
      : `---\n题名: ${c.title}\n${lineRow}状态: 已回建\n---\n`
  const lines = [
    fm,
    '',
    `# 章卡 ${c.no !== undefined ? `第${c.no}章 ` : ''}${c.title}`,
    '',
    `> 对应正文：${chapterRel}`,
    '',
    '## 一句话定位',
    '',
    c.oneLine || '（待补）',
    '',
    '## 关键事件',
    ''
  ]
  for (const b of c.beats) lines.push(`- ${b}`)
  if (!c.beats.length) lines.push('- （待补）')
  lines.push('', '## 人物进展', '', c.charProgress || '（待补）', '', '## 钩子 / 要还的债', '')
  for (const h of c.hooks) lines.push(`- ${h}`)
  if (!c.hooks.length) lines.push('- （待补）')
  lines.push('')
  return lines.join('\n')
}

/**
 * 从章卡文档解析回 OutlineCard（章卡文件为权威、重建索引时用）。
 * raw 为空（文件不存在/空文件）返回 null；rel 为相对项目根路径（如 大纲/第01章_雾港.md）。
 */
export function parseOutlineCard(raw: string, rel: string): OutlineCard | null {
  if (!raw.trim()) return null
  const noM = raw.match(/^章号:\s*(\d+)/m)
  const tM = raw.match(/^题名:\s*(.+)/m)
  const sM = raw.match(/^切片:\s*(.+)/m)
  const oneM = raw.match(/## 一句话定位\s*\n\s*\n([^\n#]+)/)
  const head = raw.split('## 人物进展')[0] ?? ''
  const beatLines = [...head.matchAll(/^- (.+)/gm)].map((m) => m[1].trim()).filter((b) => !b.startsWith('（待补）'))
  const charM = raw.match(/## 人物进展\s*\n\s*\n([^\n#]+)/)
  const hooks = [...(raw.split('## 钩子 / 要还的债')[1]?.matchAll(/^- (.+)/gm) ?? [])]
    .map((m) => m[1].trim())
    .filter((h) => !h.startsWith('（待补）'))
  const fileM = raw.match(/^> 对应正文：(.+)$/m)
  const lM = raw.match(/^时间线:\s*(.+)/m)
  const line = lM ? lM[1].trim() : ''
  return {
    file: (fileM?.[1] ?? rel.replace(/^大纲\//, '正文/')).trim(),
    no: noM ? Number(noM[1]) : undefined,
    title: tM?.[1]?.trim() ?? '（无名）',
    slice: sM?.[1]?.trim() ?? '',
    ...(line ? { line } : {}),
    oneLine: oneM?.[1]?.trim() ?? '',
    beats: beatLines,
    charProgress: charM?.[1]?.trim() ?? '',
    hooks,
    wordCount: 0
  }
}

/**
 * 重命名章后同步「写作副产物」内容（章卡/导演板/分幕通用，真机与 devShim 同口径）：
 * ① fm「题名」→ newTitle；② 文档首个 `# ` 标题行里的旧题名 → 新题名（H1 是标题权威处，
 * 正文/小节里其他出现旧题名的文字不动——副产物可能含作者手工补充）；③ 「> 对应正文：」行 → 新路径。
 * 任一模式匹配不上则跳过该处（best-effort）；无约定头/无 H1 等场景幂等返回原文。
 */
export function syncChapterNameInDoc(raw: string, oldTitle: string, newTitle: string, newChapterRel: string): string {
  if (!newTitle) return raw
  let out = setFrontMatterField(raw, '题名', newTitle)
  if (oldTitle && oldTitle !== newTitle) {
    // 只处理首个 H1 行：行尾就是旧题名才换后缀（避免子串误伤，如「雾」→「雾港」不应把「雾港」变「雾港港」）
    out = out.replace(/^(# .*)$/m, (line) =>
      line.endsWith(oldTitle) ? line.slice(0, line.length - oldTitle.length) + newTitle : line
    )
  }
  out = out.replace(/^(> 对应正文：\s*).*$/m, (_m, p1: string) => p1 + newChapterRel)
  return out
}

/**
 * 章节「切片」改名后同步写作副产物（章卡/导演板/分幕）fm 里的 `切片` 字段：
 * 仅改约定头值，正文/小节文字不动（切片名不出现在副产物 H1/正文行，与 syncChapterNameInDoc 的
 * 「题名」三点同步不同）；无约定头/值相同幂等返回原文。切片名修改的引用面收口见 store.editChapterSlice。
 */
export function syncChapterSliceInDoc(raw: string, newSlice: string): string {
  if (!newSlice) return raw
  const next = setFrontMatterField(raw, '切片', newSlice)
  return next === raw ? raw : next
}

/** 章卡列表 → 大纲/索引.md 文档（计数 + 逐章块；章卡文件为权威，索引是预览文档） */
export function outlineIndexDoc(cards: OutlineCard[]): string {
  const lines = [
    '---',
    '状态: 已回建',
    '更新: ' + new Date().toLocaleString('sv'),
    '---',
    '',
    '# 大纲区 · 章卡索引',
    '',
    cards.length
      ? `共 ${cards.length} 章已回建章卡。回建入口会把每章正文回到一张章卡；正文有变时重新回建即可覆盖。`
      : '还没有章卡。先写几章正文，再点「回建大纲」。',
    ''
  ]
  for (const c of cards) {
    const no = c.no !== undefined ? `第${c.no}章 · ` : ''
    lines.push(`## ${no}${c.title || '(无名)'}`)
    lines.push('')
    lines.push(`> 定位：${c.oneLine || '（待补）'}`)
    lines.push('')
    lines.push(`- 关键事件：${c.beats.join('；') || '—'}`)
    lines.push(`- 人物进展：${c.charProgress || '—'}`)
    lines.push(`- 钩子：${c.hooks.join('；') || '—'}`)
    lines.push('')
  }
  return lines.join('\n')
}
