// pi 内核工具（piTools）行为锁：与 zj-core 的文本契约一致——engine.translate 依赖
// ★ZJ_EDIT★ 载荷、meta 事件里的工具名、zj_read_doc 的续读提示。纯 fs，无 electron。
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { buildPiTools } from '../../src/main/agent/piTools'

let root = ''
let tools: any[] = []

const tool = (name: string) => tools.find((t) => t.name === name)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zj-pi-tools-'))
  mkdirSync(join(root, '正文'), { recursive: true })
  mkdirSync(join(root, '人物'), { recursive: true })
  writeFileSync(join(root, '正文', '第01章_开端.md'), '---\n章号: 1\n题名: 开端\n---\n雾从港口漫上来。\n\n阿七抬头看灯塔。\n')
  writeFileSync(join(root, '正文', '第02章_潮声.md'), '潮水在脚底下翻。\n')
  writeFileSync(join(root, '人物', '阿七.md'), '---\n姓名: 阿七\n---\n四十岁上下。\n')
  tools = buildPiTools({ answerDir: () => join(root, '.answers') })
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('piTools 注册面', () => {
  it('六个 zj_* 工具 + 交互类工具都在，参数是纯 JSON Schema', () => {
    const names = tools.map((t) => t.name)
    for (const n of ['zj_workspace', 'zj_list_docs', 'zj_read_doc', 'zj_search', 'zj_edit_doc', 'zj_collect_suggest', 'todo_write', 'ask_user_question'])
      expect(names).toContain(n)
    for (const t of tools) {
      expect(typeof t.execute).toBe('function')
      expect(t.parameters.type).toBe('object')
      expect(Array.isArray(t.parameters.required)).toBe(true)
      // 不引 typebox：schema 是纯字面量（pi 走 coerceWithJsonSchema 路径）
      expect(Object.getOwnPropertySymbols(t.parameters).length).toBe(0)
    }
  })

  it('agentTools 关闭时不注册交互类工具', () => {
    const only = buildPiTools({ answerDir: () => join(root, '.answers'), interactive: { todo: false, askUser: false } })
    expect(only.map((t) => t.name)).not.toContain('todo_write')
    expect(only.map((t) => t.name)).not.toContain('ask_user_question')
  })
})

describe('zj_read_doc', () => {
  it('返回约定头 + 正文，并在超长时给出可照抄的 offset', async () => {
    const r = await tool('zj_read_doc').execute('c1', { base: root, file: '正文/第01章_开端.md', maxChars: 10 })
    const text = r.content[0].text
    expect(text).toContain('【文档 · 第01章_开端.md】')
    expect(text).toContain('章号: 1')
    expect(text).toContain('雾从港口漫上来。')
    const m = text.match(/offset=(\d+)/)
    expect(m).toBeTruthy()
    const r2 = await tool('zj_read_doc').execute('c2', { base: root, file: '正文/第01章_开端.md', maxChars: 10, offset: Number(m![1]) })
    expect(r2.content[0].text).toContain('阿七抬头看灯塔。')
  })

  it('文件不存在时给出可读错误（isError）', async () => {
    const r = await tool('zj_read_doc').execute('c3', { base: root, file: '正文/没有.md' })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain('没有这个文档')
  })

  it('拒绝越出作品目录的路径', async () => {
    await expect(tool('zj_read_doc').execute('c4', { base: root, file: '../../etc/hosts' })).rejects.toThrow('路径超出作品目录')
  })
})

describe('zj_edit_doc', () => {
  const payloadOf = (text: string) => {
    const m = text.match(/★ZJ_EDIT★\n([\s\S]*?)\n★ZJ_END★/)
    expect(m).toBeTruthy()
    return JSON.parse(m![1])
  }

  it('生成 ★ZJ_EDIT★ 载荷（engine.translate 的解析契约）', async () => {
    const r = await tool('zj_edit_doc').execute('c1', {
      base: root,
      file: '正文/第02章_潮声.md',
      edits: JSON.stringify([{ find: '潮水在脚底下翻。', replace: '潮水在脚底下翻，像有人在低声念名字。', reason: '加氛围' }])
    })
    const p = payloadOf(r.content[0].text)
    expect(p.file).toBe('正文/第02章_潮声.md')
    expect(p.edits).toHaveLength(1)
    expect(p.edits[0].find).toBe('潮水在脚底下翻。')
    expect(p.edits[0].before).toContain('L1')
    expect(p.edits[0].after).toContain('念名字')
    expect(r.details.edits[0].id).toBe('e1')
  })

  it('真数组入参同样接受（pi 侧 JSON schema 不再强制字符串）', async () => {
    const r = await tool('zj_edit_doc').execute('c2', {
      base: root,
      file: '正文/第02章_潮声.md',
      edits: [{ find: '潮水', replace: '海水' }]
    })
    expect(payloadOf(r.content[0].text).edits[0].replace).toBe('海水')
  })

  it('find 缺失/重复都报错且不产出载荷', async () => {
    const r1 = await tool('zj_edit_doc').execute('c3', { base: root, file: '正文/第02章_潮声.md', edits: [{ find: '不存在的句子', replace: 'x' }] })
    expect(r1.isError).toBe(true)
    expect(r1.content[0].text).toContain('没找到')
    writeFileSync(join(root, '正文', '第03章_重复.md'), '风。\n风。\n')
    const r2 = await tool('zj_edit_doc').execute('c4', { base: root, file: '正文/第03章_重复.md', edits: [{ find: '风。', replace: '雨。' }] })
    expect(r2.isError).toBe(true)
    expect(r2.content[0].text).toContain('出现多次')
  })
})

describe('zj_search / zj_list_docs / zj_workspace / todo_write', () => {
  it('搜索命中带行号上下文', async () => {
    const r = await tool('zj_search').execute('c1', { base: root, query: '灯塔' })
    expect(r.content[0].text).toContain('正文/第01章_开端.md')
    expect(r.content[0].text).toMatch(/L\d+: /)
  })

  it('目录清单按章号排序', async () => {
    const r = await tool('zj_list_docs').execute('c1', { base: root, dir: '正文' })
    const lines = r.content[0].text.split('\n').filter((l: string) => l.startsWith('- '))
    expect(lines[0]).toContain('第01章')
    expect(lines[1]).toContain('第02章')
  })

  it('作品结构给出目录计数', async () => {
    const r = await tool('zj_workspace').execute('c1', { base: root })
    expect(r.content[0].text).toContain('正文/：2 篇')
    expect(r.content[0].text).toContain('人物/：1 篇')
  })

  it('todo_write 把全量清单放进 details（runtime 据此发 todo/write 事件）', async () => {
    const r = await tool('todo_write').execute('c1', { todos: [{ content: '读第1章', status: 'completed' }] })
    expect(r.details.todos).toEqual([{ content: '读第1章', status: 'completed' }])
    expect(r.content[0].text).toContain('1/1 完成')
  })
})