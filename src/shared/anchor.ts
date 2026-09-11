// 织卷 · 锚点归一化与标题节定位（proposals 锚点写入与 devShim 冒烟共用同一实现，口径必须一致）
// 背景：真机 applyAnchor 曾用 includes 宽松匹配，「切片：第一幕_夜」会误命中「切片：第一幕_夜雨」并整节替换（丢数据）；
// devShim 侧则是「去井号+trim 后严格相等」——两侧口径不一致。统一为：归一化后逐字符精确相等。

/** 归一化锚点：去掉行首 #（含其后空白）、全角空格转半角、去首尾空白。 */
export function normalizeAnchor(s: string): string {
  return s.replace(/^#+\s*/, '').replace(/\u3000/g, ' ').trim()
}

export interface AnchorHit {
  line: number
  level: number
}

/**
 * 在 markdown 行数组里找「与锚点精确相等」的标题节（标题文本去 # 后与归一化锚点逐字符相等）。
 * 不做 includes/前缀匹配——「切片：第一幕_夜」不得误命中「切片：第一幕_夜雨」并整节替换。
 * 返回首个命中（line=标题行号、level=标题级别）；找不到返回 null。
 */
export function findAnchorLine(lines: string[], anchor: string): AnchorHit | null {
  const want = normalizeAnchor(anchor)
  if (!want) return null
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+)$/.exec(lines[i])
    if (m && normalizeAnchor(m[2]) === want) return { line: i, level: m[1].length }
  }
  return null
}
