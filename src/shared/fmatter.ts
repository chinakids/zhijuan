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
    if (Array.isArray(v)) {
      if (v.length === 0) continue
      lines.push(`${k}: [${v.map((x) => String(x).trim()).join(', ')}]`)
    }
    else lines.push(`${k}: ${String(v)}`)
  }
  lines.push('---')
  return lines.join('\n') + '\n'
}

/** 把整份文档的正文替换为 newBody，原约定头（若有）原样保留；无约定头则直接返回 newBody */
export function withBody(raw: string, newBody: string): string {
  const m = raw.match(FM_RE)
  if (!m) return newBody
  return m[0] + newBody
}

/** 把新 front matter 写回文档（保留正文） */
export function withFrontMatter(text: string, fm: Record<string, unknown>): string {
  const { body } = extractFrontMatter(text)
  return serializeFrontMatter(fm) + body
}

/** 往约定头里的列表键（如「涉及人物」）追加一项：键存在则只改那一行（保其他行原样），不存在则在约定头块末追加一行；目录头缺失或值已存在 → 原样返回 */
export function addFrontMatterListItem(text: string, key: string, value: string): string {
  const v = value.trim()
  if (!v) return text
  const m = text.match(FM_RE)
  if (!m) return text
  const block = m[1]
  const lines = block.split('\n')
  const keyRe = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:')
  for (let i = 0; i < lines.length; i++) {
    if (!keyRe.test(lines[i])) continue
    const idx = lines[i].indexOf(':')
    const lead = (lines[i].match(/^\s*/) ?? [''])[0]
    const rawVal = lines[i].slice(idx + 1).replace(/#.*$/, '')
    const items = rawVal
      .trim()
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (items.includes(v)) return text // 已有，不动
    items.push(v)
    lines[i] = lead + key + ': [' + items.join(', ') + ']'
    return '---\n' + lines.join('\n') + text.slice(4 + block.length)
  }
  // 约定头里还没有这个键：追加在块末（正文与闭合行随之后移）
  const newBlock = block + '\n' + key + ': [' + v + ']'
  return '---\n' + newBlock + text.slice(4 + block.length)
}

/**
 * 从约定头里的列表键（如「涉及人物」）移除一项：键存在则只改那一行（保其他行原样），
 * 移除后列表为空 → 删除该键行（约定头整洁，与「未列」等价）；项不存在 / 键不存在 / 无约定头 → 原样返回。
 */
export function removeFrontMatterListItem(text: string, key: string, value: string): string {
  const v = value.trim()
  if (!v) return text
  const m = text.match(FM_RE)
  if (!m) return text
  const block = m[1]
  const lines = block.split('\n')
  const keyRe = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:')
  for (let i = 0; i < lines.length; i++) {
    if (!keyRe.test(lines[i])) continue
    const idx = lines[i].indexOf(':')
    const lead = (lines[i].match(/^\s*/) ?? [''])[0]
    const rawVal = lines[i].slice(idx + 1).replace(/#.*$/, '')
    const items = rawVal
      .trim()
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!items.includes(v)) return text // 不在列表里，不动
    const rest = items.filter((s) => s !== v)
    if (rest.length === 0) {
      lines.splice(i, 1) // 移空 → 删行
    } else {
      lines[i] = lead + key + ': [' + rest.join(', ') + ']'
    }
    return '---\n' + lines.join('\n') + text.slice(4 + block.length)
  }
  return text
}

/**
 * 设置约定头里的标量键（如「题名」）：键存在 → 只改那一行（保其他行原样、保留缩进）；
 * 键不存在 → 在约定头块末追加一行；无约定头 → 原样返回（调用方自行判断）。
 */
export function setFrontMatterField(text: string, key: string, value: string): string {
  const v = value.trim()
  if (!v) return text
  const m = text.match(FM_RE)
  if (!m) return text
  const block = m[1]
  const lines = block.split('\n')
  const keyRe = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:')
  for (let i = 0; i < lines.length; i++) {
    if (!keyRe.test(lines[i])) continue
    const idx = lines[i].indexOf(':')
    const lead = (lines[i].match(/^\s*/) ?? [''])[0]
    lines[i] = lead + key + ': ' + v
    return '---\n' + lines.join('\n') + text.slice(4 + block.length)
  }
  // 约定头里还没有这个键：追加在块末（正文与闭合行随之后移）
  return '---\n' + block + '\n' + key + ': ' + v + text.slice(4 + block.length)
}
