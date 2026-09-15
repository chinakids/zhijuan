// ===== 织卷 · 别名登记的可执行提案构造（纯函数，可单测） =====
// 称谓类检查（称谓发现 nameform / 称谓混用 mixform）的「转提案」专门处置方式（2026-09-15 智能层）：
// 旧行为把「建议+依据」以 kind=append 追加进人物档正文——指导意见混入设定资产，且会随
// buildWritingContext 进创作上下文、旧依据永存。新行为：构造 kind=replace-text 的**可执行变更**
// （把未登记称呼并入约定头「别名: [...]」），作者在提案抽屉看到的就是将落盘的精确改法。
// 规则：只在「别名: [...]」数组风格行或「姓名: X」行可定位时构造；否则返回 null（调用方回退旧行为）。
export interface AliasLineEdit {
  before: string
  after: string
}

export function aliasEditFor(raw: string, adds: string[]): AliasLineEdit | null {
  const uniq = [...new Set(adds.map((a) => a.trim()).filter((a) => a.length >= 2))]
  if (!uniq.length) return null
  const lines = raw.split('\n')
  // 前文区：首个非空行须为「---」开头的约定头块
  if (!(lines[0] ?? '').trim().startsWith('---')) return null
  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      close = i
      break
    }
  }
  if (close < 0) return null

  // ① 已有「别名:」行（数组风格才改；非数组/单值风格不猜，回退）
  for (let i = 1; i < close; i++) {
    const m = lines[i].match(/^(\s*别名\s*:\s*)(.*)$/)
    if (!m) continue
    const val = m[2].trim()
    const arr = val.match(/^\[(.*)\]$/)
    if (!arr) return null
    const existing = arr[1].split(',').map((s) => s.trim()).filter(Boolean)
    const merged = [...new Set([...existing, ...uniq])]
    const before = lines[i]
    const after = m[1] + '[' + merged.join(', ') + ']'
    if (before === after) return null
    return { before, after }
  }

  // ② 无「别名:」行：在「姓名: X」行后插入（before 落在约定头首段，正文重复出现也只替换第一处=约定头）
  for (let i = 1; i < close; i++) {
    const m = lines[i].match(/^(\s*姓名\s*:\s*)(.+)$/)
    if (m) {
      const before = lines[i]
      const after = lines[i] + '\n' + '别名: [' + uniq.join(', ') + ']'
      return { before, after }
    }
  }
  return null
}
