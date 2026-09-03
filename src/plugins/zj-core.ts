// ===== 织卷 · dsh 写作域插件（zj-core）=====
// 给 DeepSeek Harness 边车用的 cordis 插件：把织卷写作工作台的读能力开放给 agent。
// 事实来源：官方 cookbook docs/cookbook/adding-a-tool.md + references/dsh-integration.md。
// 本文件自包含（只用 node 内置模块），被 scripts/build-plugins.mjs 用 esbuild 打成
// mjs 后按包名挂到 dsh-runtime/node_modules/zj-core/ —— 边车加载它。
//
// 所有工具只读、路径钳制到 base（作品根目录）内，写操作一律走 UI 的提案制。

// ---------- 最小的 dsh 工具契约（对应 @deepseek-ai/dsh-tools，见官方 adding-a-tool）----------
interface ToolParamSpec {
  type: 'string' | 'number' | 'boolean'
  required?: boolean
  description: string
}
interface ToolDef {
  name: string
  description: string
  parameters: Record<string, ToolParamSpec>
  output: {
    schema: { type: string }
    render: (args: Record<string, unknown>, value: unknown) => { type: 'text'; text: string }[]
  }
  execute: (args: Record<string, unknown>, exec: { signal: AbortSignal }) => Promise<unknown> | unknown
}
interface Cordis {
  tools: { register: (def: ToolDef) => void }
}

// ---------- 磁盘工具（全部只在 base 内读） ----------
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'

const MAX_HEAD = 80_000 // zj_read_doc 单文件返回上限
const ABORT = new AbortController().signal // 插件当前不响应外部取消；保持接口一致

/** base 是作品根目录（绝对路径）。所有相对路径先钳制再读。 */
function clamp(base: string, rel: string): string {
  const root = resolve(base)
  const full = resolve(root, rel)
  if (full !== root && !full.startsWith(root + sep)) throw new Error(`路径超出作品目录：${rel}`)
  return full
}

function parseFrontMatter(text: string): { meta: string; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { meta: '', body: text }
  return { meta: m[1], body: text.slice(m[0].length) }
}

/** 取文件前 max 字符并给出文件信息头；超长时注明可调 maxChars 或改用 zj_search */
async function readClipped(file: string, max: number, label: string, signal?: AbortSignal): Promise<string> {
  const buf = await readFile(file, { encoding: 'utf8', signal: signal ?? ABORT })
  const { meta, body } = parseFrontMatter(buf)
  let head = `【${label} · ${basename(file)}】`
  if (meta) {
    // 保留中文约定头字段：章号/题名/切片/涉及人物/姓名/身份
    const keep = meta
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^(章号|题名|切片|时间|涉及人物|姓名|身份|标签):/.test(l))
    if (keep.length) head += '\n' + keep.join('\n')
  }
  if (body.length <= max) return `${head}\n\n${body}`
  return `${head}\n\n${body.slice(0, max)}\n\n…（剩余 ${body.length - max} 字符，可增大 maxChars 或定向 zj_search）`
}

async function walkMd(root: string, dir: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 3) return out
  let entries
  try {
    entries = await readdir(clamp(root, dir), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const rel = dir ? `${dir}/${e.name}` : e.name
    if (e.isDirectory()) {
      if (e.name === '.zhijuan') continue
      await walkMd(root, rel, depth + 1, out)
    } else if (e.name.endsWith('.md')) {
      out.push(rel)
    }
  }
  return out
}

const tools: ToolDef[] = [
  {
    name: 'zj_workspace',
    description: '查看织卷作品的总体结构：顶层目录各有多少文档、最近改动的几个文件。适合开始工作时先了解项目里有什么。',
    parameters: {
      base: { type: 'string', required: true, description: '作品根目录（绝对路径，来自上下文中的“作品根目录”）' }
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args, exec) {
      const base = String(args.base)
      const root = resolve(base)
      const dirs = await readdir(root, { withFileTypes: true })
      const lines: string[] = ['【作品结构】']
      const recent: { rel: string; mtime: number }[] = []
      for (const e of dirs) {
        if (e.name.startsWith('.') || !e.isDirectory()) continue
        const docs = await walkMd(root, e.name)
        lines.push(`- ${e.name}/：${docs.length} 篇`)
        for (const rel of docs) {
          try {
            const s = await stat(clamp(root, rel))
            recent.push({ rel, mtime: s.mtimeMs })
          } catch { /* 忽略读取失败的条目 */ }
        }
      }
      recent.sort((a, b) => b.mtime - a.mtime)
      if (recent.length) {
        lines.push('')
        lines.push('最近改动：')
        for (const r of recent.slice(0, 6)) lines.push(`- ${r.rel}`)
      }
      return lines.join('\n')
    }
  },
  {
    name: 'zj_list_docs',
    description: '列出作品某个目录下的文档清单（正文按章号排序）。dir 用相对路径，如 正文、人物、世界观、素材库；省略则列出全部。',
    parameters: {
      base: { type: 'string', required: true, description: '作品根目录（绝对路径）' },
      dir: { type: 'string', description: '相对目录名，如 正文' }
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args, exec) {
      const base = String(args.base)
      const dir = String(args.dir ?? '')
      const files = await walkMd(resolve(base), dir)
      files.sort((a, b) => {
        const na = Number(a.match(/第?(\d+)章/)?.[1])
        const nb = Number(b.match(/第?(\d+)章/)?.[1])
        if (na && nb) return na - nb
        return a.localeCompare(b, 'zh')
      })
      if (!files.length) return `（${dir || '项目里'}没有找到 .md 文档）`
      return `【${dir || '全部文档'} · ${files.length} 篇】\n` + files.map((f) => `- ${f}`).join('\n')
    }
  },
  {
    name: 'zj_read_doc',
    description:
      '读取织卷作品的某个文档正文（返回约定头和正文前部）。file 为相对作品根目录的路径，如 正文/第03章_晨雾.md、人物/阿七.md、世界观/第一幕_雾港之夜.md、素材库/桥段/追忆型开头.md。超长时按 maxChars 截断。',
    parameters: {
      base: { type: 'string', required: true, description: '作品根目录（绝对路径）' },
      file: { type: 'string', required: true, description: '相对作品根目录的文档路径' },
      maxChars: { type: 'number', description: '最多返回的字符数，默认 6000，最大 80000' }
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args, exec) {
      const base = String(args.base)
      const file = String(args.file)
      const max = Math.min(Number(args.maxChars) || 6000, MAX_HEAD)
      const full = clamp(base, file)
      try {
        return await readClipped(full, max, '文档', exec.signal)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return `（没有这个文档：${file}）`
        throw e
      }
    }
  },
  {
    name: 'zj_search',
    description: '在作品里做全文搜索，返回每个命中文件里最相关的几行。适合查某个设定、台词、人物在哪些地方出现过。dir 可限定目录（如 正文）。',
    parameters: {
      base: { type: 'string', required: true, description: '作品根目录（绝对路径）' },
      query: { type: 'string', required: true, description: '要搜索的关键词' },
      dir: { type: 'string', description: '限定在此相对目录内搜索，默认全项目' },
      maxResults: { type: 'number', description: '最多返回几个文件的命中，默认 5' }
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args, exec) {
      const base = String(args.base)
      const q = String(args.query).toLowerCase()
      const maxRes = Math.max(1, Math.min(Number(args.maxResults) || 5, 20))
      const files = await walkMd(resolve(base), String(args.dir ?? ''))
      const hits: string[] = []
      for (const rel of files) {
        if (hits.length >= maxRes) break
        let text: string
        try {
          text = await readFile(clamp(base, rel), { encoding: 'utf8', signal: exec.signal })
        } catch {
          continue
        }
        const lower = text.toLowerCase()
        if (!lower.includes(q)) continue
        const lines = text.split('\n')
        const shown: string[] = []
        for (let i = 0; i < lines.length && shown.length < 3; i++) {
          if (lines[i].toLowerCase().includes(q)) {
            const from = Math.max(0, i - 1)
            const to = Math.min(lines.length, i + 2)
            const ctx = lines.slice(from, to).join('\n').slice(0, 240)
            shown.push(`  · L${i + 1}: ${ctx}`)
          }
        }
        hits.push(`## ${rel}\n` + shown.join('\n'))
      }
      if (!hits.length) return `（全文搜索「${args.query}」没有命中）`
      return `【全文搜索「${args.query}」· ${hits.length} 个文件】\n\n` + hits.join('\n\n')
    }
  }
]

export const name = 'zj-core'
export const inject = ['tools']

export function apply(ctx: Cordis) {
  for (const t of tools) ctx.tools.register(t)
}
