// ===== 织卷 · 采集子 agent（pending 任务卡 → 独立 pi 会话执行）=====
// 通道约定（模块设计 §十一）：任务卡 `素材库/采集池/任务_<ts>.md`，status: pending → running → done|failed；
// 管道回填 `结果:`（素材路径）/`完成:`（ISO 时间）。此前 App 只写 pending 卡、主进程零消费者（任务永远 pending）；
// 本模块补上消费者：
//   1) scanPending：扫采集池，挑出 pending 卡（纯 fs）。
//   2) runCollectTask：卡置 running → 建**独立** pi 会话（sid=zj-collect-<ts>，只带采集四工具 + 采集专用
//      system prompt）→ 驱动一轮 → 以工具是否写卡判定成败（finish_collect 优先，write_material 兜底）→
//      任务卡 done/failed。超时（默认 180s）/异常一律落 failed + 原因（卡面可见，UI 不用猜）。
//   3) 自动派发：collectionEnabled===true 时，project:open 起 30s 定时扫（并发=1，同卡防重入）。
// 采集工具（web_search / web_fetch / write_material / finish_collect）实现为 pi ToolDefinition（纯 JSON Schema，
// 与 piTools.ts 同形态），只在本会话内生效——写作会话的工具集不受影响（piRuntime.createSessionWithTools 的
// replaceTools=true）。
//
// 依赖注入刻意留口（engine / fetch）：主进程默认用 piRuntime + 全局 fetch；单测/探针可替换（不跑 Electron）。
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs'
import { basename, join } from 'path'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import {
  markTaskDone,
  markTaskFailed,
  markTaskRunning,
  parseTaskCard,
  taskSessionId,
  type TaskCardView
} from '../../shared/taskCard'
import { isLibraryResultPath } from '../../shared/taskCard'
import { sanitizeFile } from '../../shared/paths'
import { writeFileAtomic } from '../fsutil'
import { projectDir } from '../store'
import { getSettings } from '../settings'
import { log } from '../log'
import { createSessionWithTools, disposeSession, driveSession, type SessionCreateOpts } from './piRuntime'

/** 任务卡所在目录（相对项目根） */
export const POOL_DIR = '素材库/采集池'
/** 默认单任务超时（毫秒）：一张卡的检索+写卡流程，180s 够用；超时即判 failed，避免定时器堆着跑 */
const DEFAULT_TIMEOUT_MS = 180_000
/** 自动派发扫描间隔 */
const AUTO_INTERVAL_MS = 30_000

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// ===================== 纯逻辑：扫卡 / 回写 =====================

export interface PendingTask {
  /** 相对采集池目录的文件名（如 任务_20261028123045.md） */
  file: string
  /** 相对项目根的路径（素材库/采集池/任务_x.md） */
  rel: string
  mtime: number
  demand: string
  keywords: string[]
  category: string
}

/** 任务卡文件名判据：任务_*.md（采集池里的文档只有任务卡，这里仍收紧，防手放素材被当任务） */
export const isTaskCardFile = (name: string): boolean => /^任务_.*\.md$/.test(name) && !name.startsWith('.')

/**
 * 扫采集池 → pending 卡列表（按 mtime 升序，先来先采）。纯 fs，projectRoot 为作品根目录绝对路径。
 * status 缺省视为 pending（与 parseTaskCard 同口径）。
 */
export function scanPendingInRoot(projectRoot: string): PendingTask[] {
  const dir = join(projectRoot, POOL_DIR)
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out: PendingTask[] = []
  for (const name of names) {
    if (!isTaskCardFile(name)) continue
    const abs = join(dir, name)
    let text: string
    let mtime: number
    try {
      text = readFileSync(abs, 'utf-8')
      mtime = statSync(abs).mtimeMs
    } catch {
      continue
    }
    const v = parseTaskCard(text)
    if (v.status !== 'pending') continue
    out.push({ file: name, rel: `${POOL_DIR}/${name}`, mtime, demand: v.demand, keywords: v.keywords, category: v.category })
  }
  return out.sort((a, b) => a.mtime - b.mtime)
}

/** 扫某个项目的 pending 卡（IPC/自动派发入口） */
export function scanPendingTasks(projectId: string): PendingTask[] {
  return scanPendingInRoot(projectDir(projectId))
}

function readCard(abs: string): string | null {
  try {
    return readFileSync(abs, 'utf-8')
  } catch {
    return null
  }
}

function writeCard(abs: string, text: string): void {
  writeFileAtomic(abs, text)
}

const nowIso = (): string => new Date().toISOString()

// ===================== 采集工具（pi ToolDefinition） =====================

type JsonSchema = Record<string, unknown>
const str = (description: string): JsonSchema => ({ type: 'string', description })
const num = (description: string): JsonSchema => ({ type: 'number', description })
function objectSchema(props: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return { type: 'object', properties: props, required, additionalProperties: false }
}
function textResult(text: string, details: Record<string, unknown> = {}, isError = false) {
  return { content: [{ type: 'text' as const, text }], details: { ...details, isError }, ...(isError ? { isError: true } : {}) }
}

export interface SearchHit {
  title: string
  url: string
  snippet: string
}

/** JSON 数组入参的两种形态（数组 / JSON 数组字符串；也吃换行/顿号分隔的裸串） */
function parseList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return []
    if (s.startsWith('[')) {
      try {
        const p = JSON.parse(s)
        if (Array.isArray(p)) return p.map((x) => String(x).trim()).filter(Boolean)
      } catch {
        /* 落到分隔切分 */
      }
    }
    return s.split(/\r?\n|[；;]|(?<=\S)、/).map((x) => x.trim()).filter(Boolean)
  }
  return []
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#x27': "'"
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z#0-9]+);/gi, (m, k) => ENTITIES[String(k).toLowerCase()] ?? m)
}

const stripTags = (s: string): string => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()

/** HTML → 纯文本（去脚本/样式/注释；块级标签转换行；压缩空白） */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br|blockquote|pre)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/** DuckDuckGo 结果链接可能是 //duckduckgo.com/l/?uddg=<encoded>，还原真实 URL */
function unwrapDdg(href: string): string {
  const h = decodeEntities(href)
  if (!h.includes('uddg=')) return h.startsWith('//') ? 'https:' + h : h
  const q = h.slice(h.indexOf('?') + 1)
  try {
    const u = new URLSearchParams(q).get('uddg')
    if (u) return u
  } catch {
    /* 解析失败按原样返回 */
  }
  return h
}

/** DuckDuckGo HTML 版结果解析（a.result__a 标题/链接 + .result__snippet 摘要，按出现顺序配对） */
export function parseDdgHtml(html: string, limit = 8): SearchHit[] {
  const anchors = [...html.matchAll(/<a([^>]*class="[^"]*result__a[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi)]
  const snippets = [...html.matchAll(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => stripTags(m[1]))
  const out: SearchHit[] = []
  for (let i = 0; i < anchors.length && out.length < limit; i++) {
    const attrs = anchors[i][1]
    const href = attrs.match(/href="([^"]+)"/)?.[1] ?? ''
    const title = stripTags(anchors[i][2])
    if (!href || !title) continue
    out.push({ title, url: unwrapDdg(href), snippet: snippets[i] ?? '' })
  }
  return out
}

/** Bing RSS（format=rss 免解析 HTML，稳）：<item><title><link><description> */
export function parseBingRss(xml: string, limit = 8): SearchHit[] {
  const out: SearchHit[] = []
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = m[1]
    const pick = (tag: string): string => {
      const t = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1] ?? ''
      return stripTags(t.replace(/^<!\[CDATA\[|\]\]>$/g, ''))
    }
    const title = pick('title')
    const url = pick('link')
    if (!title || !url) continue
    out.push({ title, url, snippet: pick('description').slice(0, 300) })
    if (out.length >= limit) break
  }
  return out
}

/**
 * 联网检索（DDG HTML 优先，空/失败退 Bing RSS）。返回命中 + 各通道错误（全失败时 caller 据 errors 报 isError）。
 * fetchImpl 可注入（单测/离线探针）。
 */
export async function webSearch(
  query: string,
  opts: { fetchImpl?: typeof fetch; limit?: number; signal?: AbortSignal } = {}
): Promise<{ hits: SearchHit[]; errors: string[] }> {
  const f = opts.fetchImpl ?? fetch
  const limit = Math.max(1, Math.min(opts.limit ?? 6, 8))
  const errors: string[] = []
  const headers = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/rss+xml' }

  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query)
    const r = await f(url, { headers, signal: opts.signal, redirect: 'follow' })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const hits = parseDdgHtml(await r.text(), limit)
    if (hits.length) return { hits, errors }
  } catch (e) {
    errors.push('duckduckgo: ' + String((e as Error)?.message ?? e))
  }

  try {
    const url = 'https://www.bing.com/search?format=rss&count=10&q=' + encodeURIComponent(query)
    const r = await f(url, { headers, signal: opts.signal, redirect: 'follow' })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const hits = parseBingRss(await r.text(), limit)
    if (hits.length) return { hits, errors }
  } catch (e) {
    errors.push('bing: ' + String((e as Error)?.message ?? e))
  }
  return { hits: [], errors }
}

export interface CollectToolDeps {
  /** 作品根目录（绝对路径） */
  root: string
  /** 任务卡相对项目根的路径（素材库/采集池/任务_x.md） */
  taskRel: string
  fetchImpl?: typeof fetch
  now?: () => number
  /** 素材落盘回调（runCollectTask 兜底判定用） */
  onMaterial?: (rel: string) => void
}

export interface CollectToolState {
  /** 本会话写过的最新素材（相对项目根） */
  lastMaterial?: string
  /** finish_collect 的入参（成功置 done 的凭据） */
  finished?: { resultRel: string; summary: string }
  materials: string[]
  searches: number
  fetches: number
}

export interface CollectToolset {
  tools: ToolDefinition[]
  state: CollectToolState
}

/** 素材目录名清洗（类别 = 素材库 一级目录，不能带分隔符） */
const safeDir = (s: string): string => sanitizeFile((s || '').trim() || '环境')

/** 同类别下不覆盖既有素材：采集_<标题>.md 已存在 → 「采集_<标题> 2.md」… */
function uniqueRel(root: string, relDir: string, base: string): { rel: string; abs: string } {
  for (let i = 1; i < 50; i++) {
    const name = i === 1 ? base : `${base} ${i}`
    const rel = `${relDir}/${name}.md`
    const abs = join(root, rel)
    if (!existsSync(abs)) return { rel, abs }
  }
  const rel = `${relDir}/${base} ${Date.now()}.md`
  return { rel, abs: join(root, rel) }
}

/** 素材卡文本（front matter 标签/来源 + 正文 + 来源清单；与素材库既有卡同形） */
export function materialDoc(opts: {
  title: string
  category: string
  content: string
  sources: string[]
  at: string
}): string {
  const tags = [opts.category, ...opts.title.split(/[、,，·\s]+/).filter(Boolean).slice(0, 3)]
  const uniq = [...new Set(tags)].slice(0, 4)
  const body = opts.content.trim()
  const fm = [
    '---',
    '标签: [' + uniq.join(', ') + ']',
    '来源: ' + (opts.sources.length ? opts.sources.join('；') : '（未注明）'),
    '采集: ' + opts.at,
    '---',
    '',
    body.startsWith('#') ? body : '# ' + opts.title + '\n\n' + body
  ]
  if (opts.sources.length) {
    fm.push('', '## 来源', '', ...opts.sources.map((s) => '- ' + s))
  }
  fm.push('')
  return fm.join('\n')
}

/** 构造采集会话的四件工具（写盘/检索都锚在 root 上；返回 state 供调用方判定成败） */
export function buildCollectToolset(deps: CollectToolDeps): CollectToolset {
  const { root } = deps
  const f = deps.fetchImpl ?? fetch
  const state: CollectToolState = { materials: [], searches: 0, fetches: 0 }
  const at = () => new Date(deps.now?.() ?? Date.now()).toISOString()
  const taskAbs = join(root, deps.taskRel)

  const tools: any[] = [
    {
      name: 'web_search',
      label: '联网检索',
      description:
        '按关键词联网检索（DuckDuckGo 优先，失败退 Bing），返回最多 8 条 title/url/snippet。用于找可写进小说的现实细节线索；读正文请接着用 web_fetch。',
      parameters: objectSchema(
        {
          query: str('检索词（具体名词/场景/年代 + 细节词，如「九十年代 小城 火车站 候车室 陈设」）'),
          maxResults: num('最多返回几条（默认 6，上限 8）')
        },
        ['query']
      ),
      async execute(_id: string, args: any) {
        const q = String(args.query ?? '').trim()
        if (!q) return textResult('（web_search 缺少 query）', {}, true)
        state.searches++
        const limit = Math.max(1, Math.min(Number(args.maxResults) || 6, 8))
        const { hits, errors } = await webSearch(q, { fetchImpl: f, limit })
        if (!hits.length) {
          return textResult(
            `（web_search「${q}」没拿到结果${errors.length ? '：' + errors.join('；') : '（两个通道都返回空）'}）\n` +
              '可以换个更短/更常见的检索词再试，或直接 web_fetch 已知站点。',
            { hits: [], errors },
            true
          )
        }
        const lines = hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? '\n   ' + h.snippet.slice(0, 160) : ''}`)
        return textResult(`【web_search「${q}」· ${hits.length} 条】\n` + lines.join('\n'), { hits, errors })
      }
    },
    {
      name: 'web_fetch',
      label: '抓网页正文',
      description: '抓取一个网页的正文文本（去脚本/样式/标签，最多返回 8000 字），返回最终 URL。用于把检索到的线索读成可用细节。',
      parameters: objectSchema({ url: str('完整 http(s) URL') }, ['url']),
      async execute(_id: string, args: any, signal?: AbortSignal) {
        const url = String(args.url ?? '').trim()
        if (!/^https?:\/\//i.test(url)) return textResult(`（web_fetch 需要 http(s) URL：${url || '空'}）`, { url }, true)
        state.fetches++
        try {
          const r = await f(url, {
            headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain' },
            signal,
            redirect: 'follow'
          })
          const raw = await r.text()
          const finalUrl = (r as any).url || url
          const text = /html|xml/i.test(r.headers?.get?.('content-type') ?? '') || /<html|<body/i.test(raw) ? htmlToText(raw) : raw
          const cut = text.slice(0, 8000)
          if (!cut.trim()) return textResult(`（web_fetch ${finalUrl} 正文为空：可能是 JS 渲染页或被拦）`, { url, finalUrl }, true)
          return textResult(`【web_fetch · ${finalUrl}】（${cut.length} 字）\n\n` + cut, {
            url,
            finalUrl,
            status: r.status,
            chars: cut.length
          })
        } catch (e) {
          return textResult(`（web_fetch ${url} 失败：${String((e as Error)?.message ?? e)}）`, { url }, true)
        }
      }
    },
    {
      name: 'write_material',
      label: '写素材卡',
      description:
        '把采集到的细节写成一张素材卡：素材库/<类别>/采集_<标题>.md（正文含「来源」清单）。一次采集只写一张卡，写完用返回的相对路径调 finish_collect。',
      parameters: objectSchema(
        {
          category: str('素材类别（= 素材库 一级目录，沿用任务卡的「类别」，如 环境/人物/桥段/行业）'),
          title: str('素材卡题名（具体可辨识，≤20 字，如「九十年代候车室陈设」）'),
          content: str('素材正文（markdown）：可用的具体细节，分小节列条目；不要抄整段原文，转述成可直接化用的写法'),
          sources: {
            description: '来源：JSON 数组或换行分隔的字符串（URL 或站点名，如 ["https://zhuanlan.zhihu.com/p/xxx"]）',
            anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }]
          }
        },
        ['category', 'title', 'content']
      ),
      async execute(_id: string, args: any) {
        const title = String(args.title ?? '').trim()
        const content = String(args.content ?? '').trim()
        if (!title) return textResult('（write_material 缺少 title）', {}, true)
        if (!content) return textResult('（write_material 缺少 content）', {}, true)
        const category = safeDir(String(args.category ?? ''))
        const sources = parseList(args.sources)
        const base = '采集_' + sanitizeFile(title).replace(/^采集_/, '')
        const { rel, abs } = uniqueRel(root, `素材库/${category}`, base)
        mkdirSync(join(root, '素材库', category), { recursive: true })
        writeFileAtomic(abs, materialDoc({ title, category, content, sources, at: at() }))
        state.lastMaterial = rel
        state.materials.push(rel)
        deps.onMaterial?.(rel)
        return textResult(`（素材已写入 ${rel}；共 ${content.length} 字、${sources.length} 条来源。下一步 finish_collect）`, {
          rel,
          category,
          sources: sources.length
        })
      }
    },
    {
      name: 'finish_collect',
      label: '收尾回填',
      description:
        '采集收尾：把任务卡置 status=done、回填「结果: 素材路径」「完成: 时间」，并在卡正文追加「采集摘要」。必须在写完素材后调用（resultRel 省略=用本会话最近写的素材卡）。',
      parameters: objectSchema(
        {
          resultRel: str('素材卡相对项目根的路径（如 素材库/环境/采集_xxx.md；省略=本会话最近写入的素材）'),
          summary: str('采集摘要（2-4 句）：采到什么、来自哪些来源、可信度/缺口')
        },
        []
      ),
      async execute(_id: string, args: any) {
        const rel = String(args.resultRel ?? '').trim() || state.lastMaterial || ''
        if (!rel) return textResult('（finish_collect 缺少 resultRel：先用 write_material 写素材卡）', {}, true)
        if (!isLibraryResultPath(rel)) return textResult(`（finish_collect 的 resultRel 必须是 素材库/ 下的 .md 相对路径：${rel}）`, { rel }, true)
        if (!existsSync(join(root, rel))) return textResult(`（resultRel 指向的文件不存在：${rel}；先 write_material 再收尾）`, { rel }, true)
        const cur = readCard(taskAbs)
        if (!cur) return textResult(`（任务卡不见了：${deps.taskRel}）`, { rel }, true)
        const summary = String(args.summary ?? '').trim()
        writeCard(taskAbs, markTaskDone(cur, rel, at(), summary))
        state.finished = { resultRel: rel, summary }
        return textResult(`（任务卡已置 done：结果 ${rel}${summary ? '；摘要已写入' : ''}）`, { rel, summary })
      }
    }
  ]

  return { tools: tools as ToolDefinition[], state }
}

// ===================== 采集 prompt =====================

/** 采集子 agent 的 system prompt（会话级覆盖；与写作会话的 prompt 完全隔离） */
export function collectSystemPrompt(): string {
  return [
    '你是织卷（长篇小说创作工作台）的「素材采集子 agent」，用中文工作。',
    '任务：按任务卡里的 需求 / 关键词 联网检索，产出能直接写进小说的**现实细节素材**（器物、场景、行业流程、地域习俗、术语、气味/光线/声音等）。',
    '',
    '你只有四个工具：',
    '- web_search(query)：联网检索，返回 title/url/snippet（最多 8 条）。',
    '- web_fetch(url)：抓网页正文（去脚本样式，最多 8000 字）。',
    '- write_material(category, title, content, sources)：写 素材库/<类别>/采集_<标题>.md。',
    '- finish_collect(resultRel, summary)：把任务卡置 done 并回填结果/完成/采集摘要。',
    '',
    '纪律：',
    '1. 先 web_search 2-4 个具体检索词（需求里的名词 + 年代/地域限定），从中挑 2-3 个可信页面 web_fetch 取细节；搜不到就如实写「未检索到」，不要编造来源。',
    '2. 素材要**具体**：名词、数量、动作、流程顺序、行话、气味与光线；每条一句话，可直接化用。不要空泛概括，不要整段抄原文（转述）。',
    '3. 只写一张素材卡：category 沿用任务卡的「类别」（缺省 环境），title 具体可辨识（≤20 字），sources 列实际用到的 URL/站点名。',
    '4. 写完素材卡立刻 finish_collect(resultRel = write_material 返回的相对路径, summary = 2-4 句：采到什么、来源、可信度与缺口)。',
    '5. 最多 8 次工具调用；不要问作者问题、不要写正文、不要动采集池里的其它文件。'
  ].join('\n')
}

/** 采集子 agent 的首轮 user prompt（任务卡字段 + 根目录 + 可选类别） */
export function collectUserPrompt(card: TaskCardView, root: string, categories: string[] = []): string {
  const lines = [
    '【采集任务卡】' + POOL_DIR + '/任务_<ts>.md',
    '需求：' + (card.demand || '（未填写）'),
    card.keywords.length ? '关键词：' + card.keywords.join('、') : '关键词：（无，自行提炼 2-4 个）',
    '类别：' + (card.category || '环境'),
    card.source ? '来源偏好：' + card.source : '来源偏好：（默认搜索引擎）',
    '【作品根目录】' + root,
    categories.length ? '【现有素材类别】' + categories.join('、') + '（新类别也可，用 write_material 的 category 指定）' : '',
    card.body ? '【任务卡正文（供参考）】\n' + card.body.slice(0, 800) : '',
    '',
    '现在开始采集：检索 → 抓正文 → 写素材卡 → finish_collect。'
  ]
  return lines.filter((l) => l !== '').join('\n')
}

/** 素材库现有类别（给模型选 category 用；失败返回空） */
export function listLibraryCategories(root: string): string[] {
  try {
    return readdirSync(join(root, '素材库'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== '采集池')
      .map((e) => e.name)
  } catch {
    return []
  }
}

// ===================== 执行器 =====================

export interface CollectorEngine {
  createSession(sid: string, opts: SessionCreateOpts): Promise<unknown>
  drive(sid: string, text: string, opts: { maxMs: number }): Promise<string>
  dispose(sid: string): void
}

let engine: CollectorEngine = {
  createSession: (sid, opts) => createSessionWithTools(sid, opts),
  drive: (sid, text, opts) => driveSession(sid, text, opts),
  dispose: (sid) => void disposeSession(sid)
}

/** 替换引擎（单测/离线探针用；不传则回默认 piRuntime 实现） */
export function setCollectorEngine(over: Partial<CollectorEngine>): void {
  engine = { ...engine, ...over }
}

export type CollectStatus = 'done' | 'failed' | 'skipped'

export interface CollectRunResult {
  ok: boolean
  status: CollectStatus
  message: string
  resultRel?: string
  ms?: number
}

/** 正在跑的任务键（root + rel）：同卡并发只跑一个 */
const running = new Set<string>()
const taskKey = (root: string, rel: string): string => root + '::' + rel

/** 当前在跑的任务（UI/诊断用） */
export function runningTasks(): string[] {
  return [...running]
}

function timeoutMs(): number {
  const env = Number(process.env.ZJ_COLLECT_TIMEOUT_MS)
  return Number.isFinite(env) && env > 1000 ? env : DEFAULT_TIMEOUT_MS
}

/**
 * 跑一张任务卡（作品根目录版；单测/探针直接调）。
 * 流程：pending 校验 → 置 running → 独立会话（仅采集四工具）→ 驱动 → 判定 → done/failed。
 * 任何异常（会话建不起来、模型报错、超时）都落到 failed + 原因，绝不留在 running。
 */
export async function runTaskInRoot(root: string, taskRel: string, opts: { force?: boolean } = {}): Promise<CollectRunResult> {
  const key = taskKey(root, taskRel)
  if (running.has(key)) return { ok: false, status: 'skipped', message: '该任务已在采集中' }
  const abs = join(root, taskRel)
  const text = readCard(abs)
  if (!text) return { ok: false, status: 'failed', message: '任务卡不存在：' + taskRel }
  const card = parseTaskCard(text)
  if (card.status !== 'pending' && !opts.force) {
    return { ok: false, status: 'skipped', message: `任务状态是 ${card.status}，不重复派发（force 可强制重跑）` }
  }

  running.add(key)
  const sid = taskSessionId(taskRel)
  const started = Date.now()
  const ms = (): number => Date.now() - started
  try {
    writeCard(abs, markTaskRunning(text))
    const toolset = buildCollectToolset({ root, taskRel })
    const categories = listLibraryCategories(root)
    await engine.createSession(sid, {
      extraTools: toolset.tools,
      replaceTools: true,
      systemPrompt: collectSystemPrompt(),
      fresh: true
    })
    log('info', `采集开始 ${taskRel}（sid=${sid}，类别=${card.category || '环境'}）`, 'collect')
    let reply = ''
    let driveErr = ''
    try {
      reply = await engine.drive(sid, collectUserPrompt(card, root, categories), { maxMs: timeoutMs() })
    } catch (e) {
      // 驱动失败（超时/模型错误）：记下原因；下面按「工具是否已写卡」判定——能救则救（模型可能已写完卡才崩）
      driveErr = String((e as Error)?.message ?? e)
      log('warn', `采集驱动失败 ${taskRel}：${driveErr}`, 'collect')
    }

    const after = readCard(abs) ?? text
    const afterCard = parseTaskCard(after)
    if (afterCard.status === 'done') {
      log('info', `采集完成 ${taskRel} → ${afterCard.result}（${ms()}ms）`, 'collect')
      return { ok: true, status: 'done', message: '采集完成', resultRel: afterCard.result, ms: ms() }
    }
    // 模型写了素材但没调 finish_collect（或调失败）：按最后一张素材兜底置 done，摘要取正文尾部
    if (toolset.state.lastMaterial) {
      const summary = (reply || '').trim().slice(-400) || '子 agent 已写素材卡（未给摘要）。'
      writeCard(abs, markTaskDone(after, toolset.state.lastMaterial, nowIso(), summary))
      log('info', `采集完成（兜底）${taskRel} → ${toolset.state.lastMaterial}（${ms()}ms）`, 'collect')
      return {
        ok: true,
        status: 'done',
        message: '采集完成（未调 finish_collect，按已写素材兜底）',
        resultRel: toolset.state.lastMaterial,
        ms: ms()
      }
    }
    const why = driveErr
      ? `采集会话失败：${driveErr}`
      : `子 agent 未产出素材（工具调用：检索 ${toolset.state.searches} 次 / 抓取 ${toolset.state.fetches} 次）`
    writeCard(abs, markTaskFailed(after, why, nowIso()))
    log('warn', `采集失败 ${taskRel}：${why}`, 'collect')
    return { ok: false, status: 'failed', message: why, ms: ms() }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    try {
      writeCard(abs, markTaskFailed(readCard(abs) ?? text, msg, nowIso()))
    } catch {
      /* 回写失败也不能抛：返回值里有原因 */
    }
    log('error', `采集异常 ${taskRel}：${msg}`, 'collect')
    return { ok: false, status: 'failed', message: msg, ms: ms() }
  } finally {
    running.delete(key)
    try {
      engine.dispose(sid)
    } catch {
      /* dispose 失败不影响结果 */
    }
  }
}

/** 跑某个项目的任务卡（IPC 入口；taskRel 相对项目根） */
export async function runCollectTask(projectId: string, taskRel: string): Promise<CollectRunResult> {
  return runTaskInRoot(projectDir(projectId), taskRel)
}

/** 扫一遍并在空闲时派发一张（并发=1，先来先采）。返回本次派发结果（无 pending 则 skipped）。 */
export async function dispatchPending(projectId: string): Promise<CollectRunResult> {
  if (runningTasks().length > 0) return { ok: false, status: 'skipped', message: '已有采集在跑（并发=1）' }
  const next = scanPendingTasks(projectId)[0]
  if (!next) return { ok: false, status: 'skipped', message: '没有待处理的采集任务' }
  return runCollectTask(projectId, next.rel)
}

// ===================== 自动派发 =====================

let autoTimer: ReturnType<typeof setInterval> | null = null
let autoProject: string | null = null

function autoTick(): void {
  const pid = autoProject
  if (!pid) return
  if (getSettings().collectionEnabled !== true) return
  if (runningTasks().length > 0) return
  if (!scanPendingTasks(pid).length) return
  void dispatchPending(pid).catch((e) => log('error', '自动派发失败：' + String((e as Error)?.message ?? e), 'collect'))
}

/**
 * 开启自动派发（project:open 时调用；同项目幂等）。开关读 settings.collectionEnabled（每次 tick 现读，
 * 设置页关掉立即生效，不用重启定时器）。启动即扫一次，之后每 30s 扫。
 */
export function startCollectorAuto(projectId: string, opts: { intervalMs?: number } = {}): void {
  if (!projectId) return
  if (autoTimer && autoProject === projectId) return
  stopCollectorAuto()
  autoProject = projectId
  autoTimer = setInterval(autoTick, Math.max(5000, opts.intervalMs ?? AUTO_INTERVAL_MS))
  // 定时器不该拖住进程退出（Electron 主进程退出时无需等待）
  ;(autoTimer as any)?.unref?.()
  setImmediate(autoTick)
  log('info', `采集自动派发已开启（项目 ${projectId}）`, 'collect')
}

export function stopCollectorAuto(): void {
  if (autoTimer) clearInterval(autoTimer)
  autoTimer = null
  autoProject = null
}

/** 自动派发状态（诊断/测试用） */
export function collectorAutoState(): { project: string | null; intervalMs: number | null } {
  return { project: autoProject, intervalMs: autoTimer ? AUTO_INTERVAL_MS : null }
}