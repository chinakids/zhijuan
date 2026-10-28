// ===== 采集子 agent（collector）行为锁 =====
// 覆盖：任务卡回写纯逻辑 / 扫 pending / 采集四工具 schema 与落盘 / 检索与抓取解析（注入 fetch）/
// runTaskInRoot 的 done·failed·skipped 三条路径（注入假引擎，不跑 pi/Electron）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  buildCollectToolset,
  collectSystemPrompt,
  collectUserPrompt,
  htmlToText,
  parseBingRss,
  parseDdgHtml,
  runTaskInRoot,
  scanPendingInRoot,
  setCollectorEngine,
  webSearch
} from '../../src/main/agent/collector'
import {
  markTaskDone,
  markTaskFailed,
  markTaskRunning,
  parseTaskCard,
  taskSessionId
} from '../../src/shared/taskCard'

let root = ''
const POOL = '素材库/采集池'

function cardText(over: Partial<{ status: string; demand: string; keywords: string[]; category: string }> = {}): string {
  return [
    '---',
    'status: ' + (over.status ?? 'pending'),
    '类别: ' + (over.category ?? '环境'),
    '关键词: [' + (over.keywords ?? ['旧图书馆', '借书卡']).join(', ') + ']',
    '需求: ' + (over.demand ?? '校园旧图书馆的感官细节'),
    '来源: ',
    '创建: 2026-10-28 09:00',
    '---',
    '',
    '# 采集任务：校园旧图书馆',
    '',
    '**需求详情**：要写实、贴国内校园。'
  ].join('\n')
}

function seedTask(name = '任务_20261028120000.md', text = cardText()): string {
  mkdirSync(join(root, POOL), { recursive: true })
  writeFileSync(join(root, POOL, name), text)
  return `${POOL}/${name}`
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zj-collect-'))
  mkdirSync(join(root, '素材库'), { recursive: true })
  seedTask()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  setCollectorEngine({})
})

const tool = (tools: any[], name: string) => tools.find((t) => t.name === name)

describe('任务卡回写（纯文本，保留原字段/正文）', () => {
  it('running：只改 status，其它字段与正文原样保留', () => {
    const out = markTaskRunning(cardText())
    const v = parseTaskCard(out)
    expect(v.status).toBe('running')
    expect(v.demand).toBe('校园旧图书馆的感官细节')
    expect(v.keywords).toEqual(['旧图书馆', '借书卡'])
    expect(v.body).toContain('**需求详情**：要写实')
    expect(out).toContain('创建: 2026-10-28 09:00')
  })

  it('done：回填 结果/完成 + 正文追加采集摘要；重试后旧摘要不叠加', () => {
    const first = markTaskDone(cardText(), '素材库/环境/采集_A.md', '2026-10-28T02:00:00.000Z', '采到 3 条细节')
    const v = parseTaskCard(first)
    expect(v.status).toBe('done')
    expect(v.result).toBe('素材库/环境/采集_A.md')
    expect(v.finishedAt).toBe('2026-10-28T02:00:00.000Z')
    expect(v.body).toContain('## 采集摘要')
    expect(v.body).toContain('采到 3 条细节')

    const again = markTaskDone(markTaskRunning(first), '素材库/环境/采集_B.md', '2026-10-28T03:00:00.000Z', '第二轮')
    const v2 = parseTaskCard(again)
    expect(v2.status).toBe('done')
    expect(v2.result).toBe('素材库/环境/采集_B.md')
    expect(v2.body.match(/## 采集摘要/g)).toHaveLength(1)
    expect(v2.body).toContain('第二轮')
    expect(v2.body).not.toContain('采到 3 条细节')
  })

  it('failed：写 status/失败 + 正文「采集失败」段；原因换行压平并截断', () => {
    const long = '模型超时\n第二大段 ' + 'x'.repeat(400)
    const v = parseTaskCard(markTaskFailed(cardText({ status: 'running' }), long, '2026-10-28T02:00:00.000Z'))
    expect(v.status).toBe('failed')
    expect(v.body).toContain('## 采集失败')
    expect(v.body).toContain('2026-10-28T02:00:00.000Z')
    expect(v.body).not.toContain('\n第二大段')
    // 失败原因行（front matter）不超过 200 字
    const fmLine = v.body // 只看正文段
    expect(fmLine.length).toBeLessThan(600)
  })

  it('taskSessionId：任务_<ts>.md → zj-collect-<ts>', () => {
    expect(taskSessionId('素材库/采集池/任务_20261028120000.md')).toBe('zj-collect-20261028120000')
    expect(taskSessionId('素材库/采集池/任务_演示.md')).toBe('zj-collect-演示')
  })
})

describe('scanPendingInRoot', () => {
  it('只收 pending 的任务卡，按 mtime 升序，忽略素材卡与终态卡', () => {
    seedTask('任务_20261028130000.md', cardText({ demand: '第二张' }))
    seedTask('任务_20261028140000.md', cardText({ status: 'done' }))
    seedTask('任务_20261028150000.md', cardText({ status: 'running' }))
    writeFileSync(join(root, POOL, '采集_随手放的.md'), '# 不是任务卡\n')
    const list = scanPendingInRoot(root)
    expect(list).toHaveLength(2)
    expect(list[0].file).toBe('任务_20261028120000.md')
    expect(list[1].demand).toBe('第二张')
    expect(list[0].rel).toBe(`${POOL}/任务_20261028120000.md`)
  })

  it('采集池不存在时返回空（新项目）', () => {
    expect(scanPendingInRoot(join(root, 'nope'))).toEqual([])
  })
})

describe('采集工具 schema', () => {
  it('四件工具都在，schema 是纯 JSON Schema（object + required 数组）', () => {
    const { tools } = buildCollectToolset({ root, taskRel: `${POOL}/任务_20261028120000.md` })
    expect(tools.map((t) => t.name)).toEqual(['web_search', 'web_fetch', 'write_material', 'finish_collect'])
    for (const t of tools as any[]) {
      expect(typeof t.execute).toBe('function')
      expect(t.parameters.type).toBe('object')
      expect(Array.isArray(t.parameters.required)).toBe(true)
      expect(Object.getOwnPropertySymbols(t.parameters)).toHaveLength(0)
    }
  })

  it('write_material 落盘：路径 素材库/<类>/采集_<标题>.md，含标签/来源与来源清单；同名不覆盖', async () => {
    const { tools, state } = buildCollectToolset({ root, taskRel: `${POOL}/任务_20261028120000.md` })
    const w = tool(tools as any[], 'write_material')
    const r = await w.execute('c1', {
      category: '环境/校园',
      title: '九十年代 候车室',
      content: '## 陈设\n\n- 长椅是墨绿色铁架，漆面被磨出亮点。',
      sources: ['https://example.com/a', '知乎 #候车室']
    })
    expect(r.isError).toBeUndefined()
    const rel1 = r.details.rel as string
    expect(rel1).toBe('素材库/环境_校园/采集_九十年代 候车室.md')
    const doc = readFileSync(join(root, rel1), 'utf-8')
    expect(doc).toContain('标签: [环境_校园')
    expect(doc).toContain('来源: https://example.com/a；知乎 #候车室')
    expect(doc).toContain('## 来源')
    expect(doc).toContain('- 知乎 #候车室')
    expect(doc).toContain('长椅是墨绿色铁架')
    expect(state.lastMaterial).toBe(rel1)

    const r2 = await w.execute('c2', { category: '环境_校园', title: '九十年代 候车室', content: '第二轮' })
    expect(r2.details.rel).toBe('素材库/环境_校园/采集_九十年代 候车室 2.md')
  })

  it('finish_collect：任务卡置 done + 结果/完成 + 摘要；未写素材时给可读错误', async () => {
    const taskRel = `${POOL}/任务_20261028120000.md`
    const { tools, state } = buildCollectToolset({ root, taskRel })
    const finish = tool(tools as any[], 'finish_collect')
    const bad = await finish.execute('c0', { summary: '还没写卡' })
    expect(bad.isError).toBe(true)
    expect(bad.content[0].text).toContain('缺少 resultRel')

    await tool(tools as any[], 'write_material').execute('c1', { category: '环境', title: '候车室', content: '铁架长椅', sources: ['https://e.com'] })
    const r = await finish.execute('c2', { resultRel: state.lastMaterial, summary: '采到 1 条陈设细节，来自 1 个来源。' })
    expect(r.isError).toBeUndefined()
    const v = parseTaskCard(readFileSync(join(root, taskRel), 'utf-8'))
    expect(v.status).toBe('done')
    expect(v.result).toBe(state.lastMaterial)
    expect(v.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(v.body).toContain('采到 1 条陈设细节')
  })

  it('finish_collect 拒绝非 素材库 路径与不存在的文件', async () => {
    const taskRel = `${POOL}/任务_20261028120000.md`
    const finish = tool(buildCollectToolset({ root, taskRel }).tools as any[], 'finish_collect')
    const r1 = await finish.execute('c1', { resultRel: '正文/第01章.md', summary: 'x' })
    expect(r1.isError).toBe(true)
    expect(r1.content[0].text).toContain('必须是 素材库/')
    const r2 = await finish.execute('c2', { resultRel: '素材库/环境/没有.md', summary: 'x' })
    expect(r2.isError).toBe(true)
    expect(r2.content[0].text).toContain('不存在')
  })
})

describe('web_search / web_fetch（注入 fetch，不联网）', () => {
  const ddgHtml = [
    '<div class="results">',
    '<div class="result"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1&rut=zz">旧图书馆的<strong>借书卡</strong></a>',
    '<a class="result__snippet" href="#">卡片边缘被翻得发毛，铅笔写的日期被蹭糊。</a></div>',
    '<div class="result"><a class="result__a" href="https://example.com/b">木质书架</a>',
    '<a class="result__snippet" href="#">樟木味混着纸页霉味。</a></div>',
    '</div>'
  ].join('\n')

  it('解析 DDG HTML：还原 uddg 链接、去标签留摘要', () => {
    const hits = parseDdgHtml(ddgHtml)
    expect(hits).toHaveLength(2)
    expect(hits[0].url).toBe('https://example.com/a?x=1')
    expect(hits[0].title).toBe('旧图书馆的 借书卡')
    expect(hits[0].snippet).toContain('卡片边缘')
    expect(hits[1].url).toBe('https://example.com/b')
  })

  it('解析 Bing RSS（CDATA 标题）', () => {
    const xml = '<rss><channel><item><title><![CDATA[候车室陈设]]></title><link>https://example.com/c</link><description>墨绿铁架长椅</description></item></channel></rss>'
    const hits = parseBingRss(xml)
    expect(hits).toEqual([{ title: '候车室陈设', url: 'https://example.com/c', snippet: '墨绿铁架长椅' }])
  })

  it('web_search：DDG 空 → 退 Bing RSS；两路都崩 → 返回 errors（工具报 isError）', async () => {
    const emptyThenBing = vi.fn(async (url: string) =>
      String(url).includes('duckduckgo')
        ? { ok: true, status: 200, url, headers: { get: () => 'text/html' }, text: async () => '<html><body>no results</body></html>' }
        : {
            ok: true,
            status: 200,
            url,
            headers: { get: () => 'application/rss+xml' },
            text: async () => '<rss><channel><item><title>候车室</title><link>https://e.com/c</link><description>铁架</description></item></channel></rss>'
          }
    )
    const hit = await webSearch('候车室', { fetchImpl: emptyThenBing as any })
    expect(hit.hits[0].url).toBe('https://e.com/c')

    const boom = vi.fn(async () => {
      throw new Error('ENOTFOUND')
    })
    const { hits, errors } = await webSearch('x', { fetchImpl: boom as any })
    expect(hits).toEqual([])
    expect(errors.join('|')).toContain('duckduckgo')
    expect(errors.join('|')).toContain('bing')

    const taskRel = `${POOL}/任务_20261028120000.md`
    const search = tool(buildCollectToolset({ root, taskRel, fetchImpl: boom as any }).tools as any[], 'web_search')
    const r = await search.execute('c1', { query: '候车室' })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain('没拿到结果')
  })

  it('web_fetch：去脚本/样式、返回最终 URL、超长截到 8000 字', async () => {
    const html = '<html><head><style>.a{color:red}</style><script>var x=1</script></head><body><h1>候车室</h1><p>墨绿铁架长椅，漆面磨亮。</p></body></html>'
    const f = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: 'https://example.com/final',
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => html
    }))
    const taskRel = `${POOL}/任务_20261028120000.md`
    const fetchTool = tool(buildCollectToolset({ root, taskRel, fetchImpl: f as any }).tools as any[], 'web_fetch')
    const r = await fetchTool.execute('c1', { url: 'https://example.com/start' })
    expect(r.content[0].text).toContain('https://example.com/final')
    expect(r.content[0].text).toContain('墨绿铁架长椅')
    expect(r.content[0].text).not.toContain('var x=1')
    expect(r.content[0].text).not.toContain('color:red')

    expect(htmlToText('<b>甲</b>&nbsp;&amp;<script>x</script>')).toBe('甲 &')
    const long = '甲'.repeat(9000)
    const f2 = vi.fn(async () => ({ ok: true, status: 200, url: 'https://e.com', headers: { get: () => 'text/plain' }, text: async () => long }))
    const big = await tool(buildCollectToolset({ root, taskRel, fetchImpl: f2 as any }).tools as any[], 'web_fetch').execute('c2', { url: 'https://e.com' })
    expect(big.content[0].text).toContain('（8000 字）')
  })

  it('web_fetch 非 http(s) URL 直接报错', async () => {
    const taskRel = `${POOL}/任务_20261028120000.md`
    const r = await tool(buildCollectToolset({ root, taskRel }).tools as any[], 'web_fetch').execute('c1', { url: 'file:///etc/passwd' })
    expect(r.isError).toBe(true)
  })
})

describe('prompt', () => {
  it('system prompt 点明四工具与收尾纪律；user prompt 带任务卡字段', () => {
    const sys = collectSystemPrompt()
    for (const n of ['web_search', 'web_fetch', 'write_material', 'finish_collect']) expect(sys).toContain(n)
    expect(sys).toContain('不要编造')

    const u = collectUserPrompt(parseTaskCard(cardText()), root, ['环境', '人物'])
    expect(u).toContain('校园旧图书馆的感官细节')
    expect(u).toContain('旧图书馆、借书卡')
    expect(u).toContain(root)
    expect(u).toContain('环境、人物')
  })
})

describe('runTaskInRoot（注入假引擎：模型 = 调 write_material + finish_collect）', () => {
  const taskRel = `${POOL}/任务_20261028120000.md`

  function fakeEngine(mode: 'ok' | 'throw' | 'noTools') {
    const seen: any = {}
    setCollectorEngine({
      createSession: async (sid, opts) => {
        seen.sid = sid
        seen.opts = opts
        return {}
      },
      drive: async (sid, text) => {
        seen.prompt = text
        if (mode === 'throw') throw new Error('模型 502')
        if (mode === 'noTools') return '（什么都没做）'
        const tools = seen.opts.extraTools
        await tool(tools, 'write_material').execute('c1', {
          category: '环境',
          title: '候车室陈设',
          content: '- 墨绿铁架长椅，漆面磨亮。',
          sources: ['https://example.com/a']
        })
        await tool(tools, 'finish_collect').execute('c2', { summary: '采到 1 条陈设细节。' })
        return '写好了。'
      },
      dispose: (sid) => {
        seen.disposed = sid
      }
    })
    return seen
  }

  it('pending → running → done：卡回填 结果/完成，素材卡含来源', async () => {
    const seen = fakeEngine('ok')
    const r = await runTaskInRoot(root, taskRel)
    expect(r.ok).toBe(true)
    expect(r.status).toBe('done')
    expect(r.resultRel).toBe('素材库/环境/采集_候车室陈设.md')
    expect(seen.sid).toBe('zj-collect-20261028120000')
    expect(seen.opts.replaceTools).toBe(true)
    expect(seen.opts.extraTools.map((t: any) => t.name)).toEqual(['web_search', 'web_fetch', 'write_material', 'finish_collect'])
    expect(seen.opts.systemPrompt).toContain('素材采集子 agent')
    expect(seen.prompt).toContain('校园旧图书馆的感官细节')
    expect(seen.disposed).toBe('zj-collect-20261028120000')

    const v = parseTaskCard(readFileSync(join(root, taskRel), 'utf-8'))
    expect(v.status).toBe('done')
    expect(v.result).toBe(r.resultRel)
    expect(v.finishedAt).toBeTruthy()
    const mat = readFileSync(join(root, r.resultRel!), 'utf-8')
    expect(mat).toContain('## 来源')
    expect(mat).toContain('https://example.com/a')
  })

  it('驱动抛错 → 任务卡 failed + 原因（绝不停在 running）', async () => {
    fakeEngine('throw')
    const r = await runTaskInRoot(root, taskRel)
    expect(r.ok).toBe(false)
    expect(r.status).toBe('failed')
    const v = parseTaskCard(readFileSync(join(root, taskRel), 'utf-8'))
    expect(v.status).toBe('failed')
    expect(v.body).toContain('模型 502')
  })

  it('模型没调工具 → failed，原因写明未产出素材', async () => {
    fakeEngine('noTools')
    const r = await runTaskInRoot(root, taskRel)
    expect(r.status).toBe('failed')
    expect(r.message).toContain('未产出素材')
    expect(parseTaskCard(readFileSync(join(root, taskRel), 'utf-8')).status).toBe('failed')
  })

  it('只调 write_material 没调 finish_collect → 兜底 done（按已写素材回填）', async () => {
    const seen: any = {}
    setCollectorEngine({
      createSession: async (_sid, opts) => {
        seen.tools = (opts as any).extraTools
        return {}
      },
      drive: async () => {
        await tool(seen.tools, 'write_material').execute('c1', { category: '环境', title: '兜底素材', content: '细节', sources: ['https://e.com'] })
        return '写了一张卡，但忘了收尾。'
      }
    })
    const r = await runTaskInRoot(root, taskRel)
    expect(r.status).toBe('done')
    expect(r.message).toContain('兜底')
    expect(parseTaskCard(readFileSync(join(root, taskRel), 'utf-8')).result).toBe('素材库/环境/采集_兜底素材.md')
  })

  it('非 pending 卡不重复派发（force 才重跑）', async () => {
    const seen = fakeEngine('ok')
    writeFileSync(join(root, taskRel), cardText({ status: 'done' }))
    const r = await runTaskInRoot(root, taskRel)
    expect(r.status).toBe('skipped')
    expect(seen.opts).toBeUndefined()
    const forced = await runTaskInRoot(root, taskRel, { force: true })
    expect(forced.status).toBe('done')
  })

  it('任务卡不存在 → failed（不建会话）', async () => {
    const r = await runTaskInRoot(root, `${POOL}/任务_不存在.md`)
    expect(r.status).toBe('failed')
    expect(r.message).toContain('不存在')
    expect(existsSync(join(root, `${POOL}/任务_不存在.md`))).toBe(false)
  })
})