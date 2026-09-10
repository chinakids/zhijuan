import type { Node as PMNode } from 'prosemirror-model'

/**
 * 正文查找纯逻辑（Apple HIG Keyboards：⌘F/⌘G/⇧⌘G 的标准查找体验由 Prose.tsx 接入）。
 *
 * 设计取舍：
 * - ProseMirror 把不同 mark（如加粗）拆成相邻 TextNode，但**不会**产生中间容器节点，
 *   因此「同父 + pos 连续」的 TextNode 可合并成一个 run 后再查——跨行内标记的词也能命中；
 *   hardBreak/图片等非文本节点会打断 run（跨硬换行的匹配不做，除非必要再扩展）。
 * - 大小写不敏感查找（中文无影响）；纯字面匹配（不经正则，用户输入永远按原样匹配）。
 * - 只返回 from/to 位置，不动视图；高亮/跳转由调用方（view + CSS Custom Highlight API）负责。
 */

export interface FindPos {
  from: number
  to: number
}

interface Segment {
  pos: number
  len: number
}

interface Run {
  parent: unknown
  text: string
  segments: Segment[]
  end: number
}

/** 把 run 内字符偏移映射回 doc pos（相邻 TextNode pos 连续，跨段映射成立） */
function mapPos(run: Run, offset: number): number {
  if (offset <= 0) return run.segments[0].pos
  let acc = 0
  for (const s of run.segments) {
    if (offset < acc + s.len) return s.pos + (offset - acc)
    acc += s.len
    if (offset === acc) continue // 恰在段尾后：下一段起点与本偏移相同
  }
  const last = run.segments[run.segments.length - 1]
  return last.pos + last.len
}

export function findInDoc(doc: PMNode, query: string): FindPos[] {
  const out: FindPos[] = []
  if (!query) return out
  // 个别 Unicode 字符 toLowerCase 会改变长度（如 İ）——此时回退到原样匹配，保证位置映射正确
  const q = query.toLowerCase()
  const sensitive = q.length !== query.length
  const needle = sensitive ? query : q

  const runs: Run[] = []
  let cur: Run | null = null
  doc.descendants((node, pos, parent) => {
    // 实测（prosemirror-model 1.25）：descendants 回传的 pos 即标准 doc 坐标
    // （首文本节点 = pos 1，textBetween(1, len+1) 可直接取出该文本）——无需+1换算
    const p = pos
    if (node.isText && node.text) {
      const text = node.text
      if (cur && cur.parent === parent && cur.end === p) {
        cur.text += text
        cur.segments.push({ pos: p, len: text.length })
        cur.end = p + text.length
      } else {
        cur = { parent, text, segments: [{ pos: p, len: text.length }], end: p + text.length }
        runs.push(cur)
      }
    } else {
      cur = null // 非文本节点打断合并
    }
    return true
  })

  for (const run of runs) {
    const hay = sensitive ? run.text : run.text.toLowerCase()
    if (!sensitive && hay.length !== run.text.length) continue
    const needleLen = needle.length
    let idx = hay.indexOf(needle)
    let from = 0
    while (idx >= 0) {
      out.push({ from: mapPos(run, idx), to: mapPos(run, idx + needleLen) })
      from = idx + needleLen
      idx = hay.indexOf(needle, from)
    }
  }
  return out
}
