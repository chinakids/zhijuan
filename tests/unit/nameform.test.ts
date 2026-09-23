import { describe, expect, it } from 'vitest'
import { nameFormCheck, surnameOf } from '../../src/shared/nameform'

const ch = (file: string, body: string): { file: string; raw: string } => ({
  file,
  raw: `---\n章号: ${file.match(/(\d+)/)?.[1] ?? '1'}\n题名: ${file}\n涉及人物: [陈默]\n---\n` + body
})

describe('surnameOf（姓名 → 姓提取）', () => {
  it('常见单姓取首字', () => {
    expect(surnameOf('陈默')).toBe('陈')
    expect(surnameOf('沈藏')).toBe('沈')
    expect(surnameOf('顾岸')).toBe('顾')
  })
  it('复姓优先于单姓', () => {
    expect(surnameOf('欧阳成')).toBe('欧阳')
    expect(surnameOf('司马昭')).toBe('司马')
  })
  it('无常见姓返回 null（单字名/代号/网名）', () => {
    expect(surnameOf('阿七')).toBeNull()
    expect(surnameOf('七夜')).toBeNull()
    expect(surnameOf('')).toBeNull()
  })
})

describe('nameFormCheck（称谓发现核查纯函数）', () => {
  it('基础命中：正文「陈师傅」未登记 → low/character/target 指向档案', () => {
    const r = nameFormCheck({
      knownChars: ['陈默'],
      chapters: [ch('正文/第01章_雾港.md', '陈师傅从门里探出半个头。\n')]
    })
    expect(r.items).toHaveLength(1)
    const it = r.items[0]
    expect(it.severity).toBe('low')
    expect(it.type).toBe('character')
    expect(it.what).toContain('「陈师傅」')
    expect(it.what).toContain('「陈默」')
    expect(it.target).toBe('人物/陈默.md')
    expect(it.where).toContain('正文/第01章_雾港.md')
    expect(r.summary).toContain('1 个')
  })

  it('后缀最长优先：正文「陈老师傅把话说完」→ 报「陈老师傅」（不拆成陈老师）', () => {
    const r = nameFormCheck({
      knownChars: ['陈默'],
      chapters: [ch('正文/第01章_雾港.md', '陈老师傅把话说完。\n')]
    })
    expect(r.items).toHaveLength(1)
    expect(r.items[0].what).toContain('「陈老师傅」')
  })

  it('前缀模式：正文「老陈」「小陈」→ 各一条', () => {
    const r = nameFormCheck({
      knownChars: ['陈默'],
      chapters: [ch('正文/第01章_雾港.md', '老陈点了头，小陈没说话。\n')]
    })
    expect(r.items).toHaveLength(2)
    expect(r.items.map((i) => i.what).join('')).toContain('「老陈」')
    expect(r.items.map((i) => i.what).join('')).toContain('「小陈」')
  })

  it('已登记为该人物别名 → 不报', () => {
    const r = nameFormCheck({
      knownChars: ['陈默'],
      aliasMap: { 陈默: ['陈师傅'] },
      chapters: [ch('正文/第01章_雾港.md', '陈师傅从门里探出半个头。\n')]
    })
    expect(r.items).toHaveLength(0)
    expect(r.summary).toContain('未发现')
  })

  it('别名冲突（多主）不参与', () => {
    const r = nameFormCheck({
      knownChars: ['陈默', '陈航'],
      aliasMap: { 陈默: ['陈师傅'], 陈航: ['陈师傅'] },
      chapters: [ch('正文/第01章_雾港.md', '陈师傅从门里探出半个头。\n')]
    })
    expect(r.items).toHaveLength(0)
  })

  it('归属重叠（同姓两人都未登记同一变体）→ 不报（避免指认错误）', () => {
    const r = nameFormCheck({
      knownChars: ['陈默', '陈航'],
      chapters: [ch('正文/第01章_雾港.md', '陈师傅从门里探出半个头。\n')]
    })
    expect(r.items).toHaveLength(0)
  })

  it('变体等于他人本名/别名 → 不报', () => {
    const r = nameFormCheck({
      knownChars: ['陈默', '阿七', '陈师傅'],
      aliasMap: { 阿七: ['老陈'] },
      chapters: [ch('正文/第01章_雾港.md', '陈师傅从门里探出半个头。老陈也在场。\n')]
    })
    // 陈师傅 = 人物「陈师傅」本名 → 不报；老陈 = 阿七别名 → 不报；唯一剩下的「阿七」无姓 → 无人可报
    expect(r.items).toHaveLength(0)
  })

  it('复姓：正文「欧阳老师」→ 命中「欧阳成」未登记称谓', () => {
    const r = nameFormCheck({
      knownChars: ['欧阳成'],
      chapters: [ch('正文/第01章_雾港.md', '欧阳老师推开窗。\n')]
    })
    expect(r.items).toHaveLength(1)
    expect(r.items[0].what).toContain('「欧阳老师」')
    expect(r.items[0].target).toBe('人物/欧阳成.md')
  })

  it('front matter 与 HTML 注释不计入正文', () => {
    const raw =
      `---\n章号: 1\n题名: 陈师傅\n涉及人物: [陈默]\n别名: [陈师傅]\n---\n` +
      '<!-- 陈师傅在注释里 -->\n正文没有称谓。\n'
    const r = nameFormCheck({ knownChars: ['陈默'], chapters: [{ file: '正文/第01章_雾港.md', raw }] })
    expect(r.items).toHaveLength(0)
  })

  it('同一人物×变体只报第一次出现（where 指先到章）', () => {
    const r = nameFormCheck({
      knownChars: ['陈默'],
      chapters: [
        ch('正文/第01章_雾港.md', '陈师傅先来。\n'),
        ch('正文/第02章_灯下.md', '陈师傅又来。\n')
      ]
    })
    expect(r.items).toHaveLength(1)
    expect(r.items[0].where).toContain('第01章')
    expect(r.items[0].what).toContain('首次出现处')
  })

  it('无人物 / 无可识别姓 → 无可核查对象', () => {
    const r1 = nameFormCheck({ knownChars: [], chapters: [] })
    expect(r1.items).toHaveLength(0)
    expect(r1.summary).toContain('没有可从名字识别出姓')
    const r2 = nameFormCheck({ knownChars: ['阿七'], chapters: [ch('正文/第01章_雾港.md', '阿七在码头。\n')] })
    expect(r2.items).toHaveLength(0)
  })

  it('单字名/代号人物不参与（阿七的「七爷」不报）', () => {
    const r = nameFormCheck({
      knownChars: ['阿七', '陈默'],
      chapters: [ch('正文/第01章_雾港.md', '七爷在码头等船。\n')]
    })
    // 只有陈默可查且正文无陈姓称谓 → 零命中
    expect(r.items).toHaveLength(0)
  })
})
