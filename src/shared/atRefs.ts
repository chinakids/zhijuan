// ===== 织卷 · @ 引用标记（纯逻辑，可单测；main 与 renderer 共用同口径） =====
// 输入框 @ 功能插入的引用文本形态：〔类型·名称｜路径〕；发送时主进程解析并注入上下文。
// 本文件只放解析与预算常量（无文件依赖），渲染层据此展示注入预算，主进程据此展开内容。
// 预算口径见 REF_CAP：单引用 ≤each 字符、合计 ≤total 字符（超预算截断并标记）。

export interface AtRef {
  type: string
  name: string
  /** 项目相对路径（如 人物/沈藏.md） */
  file: string
}

const REF_RE = /〔([^〔〕·]+?)·([^〔〕｜]+?)｜([^〔〕]+?)〕/g

/** 单引用预算 / 引用合计预算（字符）——主进程 inflateRefs 与渲染层展示必须同值 */
export const REF_CAP = { each: 4000, total: 12000 }

/** 从文本中提取全部 @ 引用标记（输入框插入形态：〔类型·名称｜路径〕） */
export function parseAtRefs(text: string): AtRef[] {
  const out: AtRef[] = []
  for (const m of text.matchAll(REF_RE)) {
    const type = m[1].trim()
    const name = m[2].trim()
    const file = m[3].trim()
    if (type && name && file) out.push({ type, name, file })
  }
  return out
}
