// ===== 织卷 V2 · 约定头（front matter）解析与生成（模块设计 §2.3） =====
// 极简实现：只认字母数字键的 `key: value` 行，以及 `key: [a, b]` 的数组，够用即可，
// 不引入 yaml 依赖（约定本身就是最小的）。

export interface FrontMatter {
  [key: string]: string | number | string[]
}

const FM_RE = /^---\n([\s\S]*?)\n---\s*(\n|$)/

/** 从文档文本里提出 front matter（无则 null）。返回 { fm, body } */
export function extractFrontMatter(text: string): { fm: FrontMatter | null; body: string; raw: string } {
  const m = text.match(FM_RE)
  if (!m) return { fm: null, body: text, raw: '' }
  const raw = m[1]
  const fm: FrontMatter = {}
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    let val: string = line.slice(idx + 1).trim()
    if (!key) continue
    // 去掉行尾注释（# 后为注释）
    const hash = val.indexOf('#')
    if (hash >= 0) val = val.slice(0, hash).trim()
    const arrM = val.match(/^\[(.*)\]$/)
    if (arrM) {
      const items = arrM[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (items.length) fm[key] = items
      continue
    }
    fm[key] = val
  }
  return { fm, body: text.slice(m[0].length), raw }
}

/** 序列化 front matter（对象 → yaml-ish 块） */
export function serializeFrontMatter(fm: Record<string, unknown>): string {
  const lines = ['---']
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) lines.push(`${k}: [${v.map((x) => String(x).trim()).join(', ')}]`)
    else lines.push(`${k}: ${String(v)}`)
  }
  lines.push('---')
  return lines.join('\n') + '\n'
}

/** 把新 front matter 写回文档（保留正文） */
export function withFrontMatter(text: string, fm: Record<string, unknown>): string {
  const { body } = extractFrontMatter(text)
  return serializeFrontMatter(fm) + body
}
