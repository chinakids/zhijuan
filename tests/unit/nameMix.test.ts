import { describe, expect, it } from 'vitest'
import { nameMixCheck, stripDialogue } from '../../src/shared/nameform'

const ch = (file: string, body: string): { file: string; raw: string } => ({
  file,
  raw: `---\n章号: ${file.match(/(\d+)/)?.[1] ?? '1'}\n题名: ${file}\n涉及人物: [陈默]\n---\n` + body
})

describe('stripDialogue（叙述层抽取）', () => {
  it('成对引号内容被剥除（防对话中人物互相称呼被当混用）', () => {
    expect(stripDialogue('他说：“沈爷，等等。”然后走了。')).toBe('他说： 然后走了。')
    expect(stripDialogue('「藏哥，别动！」她压低声音。')).toBe(' 她压低声音。')
    expect(stripDialogue("他说:\"老陈，喝茶。\"就离开了。")).toBe('他说: 就离开了。')
    expect(stripDialogue("他叹道：‘沈爷，算了吧。’扬长而去。")).toBe('他叹道： 扬长而去。')
  })
  it('不成对引号不剥（漏报方向安全），替换为空格防拼接', () => {
    // 只有开引号没有闭引号 → 不剥；「陈默」不会与周边拼接出假称谓
    expect(stripDialogue('他说“陈默还没来。')).toContain('陈默')
    expect(stripDialogue('“沈爷”。陈默')).toBe(' 。陈默')
  })
})

describe('nameMixCheck（同章同人称谓混用核查纯函数）', () => {
  it('正例：三变体交替 ≥3 次 → low/character/target 指向档案', () => {
    const r = nameMixCheck({
      knownChars: ['陈默'],
      chapters: [ch('正文/第01章_雾港.md', '陈师傅推门。陈默抬头。老陈坐下。陈默开口。陈师傅打断了他。\n')]
    })
    expect(r.items).toHaveLength(1)
    const it = r.items[0]
    expect(it.severity).toBe('low')
    expect(it.type).toBe('character')
    expect(it.what).toContain('「陈师傅」「陈默」「老陈」')
    expect(it.what).toContain('5 处')
    expect(it.what).toContain('交替 4 次')
    expect(it.what).toContain('若并非刻意')
    expect(it.target).toBe('人物/陈默.md')
    expect(it.where).toContain('正文/第01章_雾港.md')
    expect(r.summary).toContain('1 章')
  })

  it('正例：登记别名参与（沈藏+沈爷 同章交替）——别名是有意称呼但同章来回仍须克制', () => {
    const r = nameMixCheck({
      knownChars: ['沈藏'],
      aliasMap: { 沈藏: ['沈爷'] },
      chapters: [ch('正文/第03章_码头.md', '沈藏站在船头。沈爷在码头喊他。沈藏没回头。沈爷又喊。沈藏才应了一声。\n')]
    })
    expect(r.items).toHaveLength(1)
    expect(r.items[0].what).toContain('「沈爷」')
    expect(r.items[0].what).toContain('「沈藏」')
  })

  it('反例：对话内混用不报（只取叙述层）', () => {
    const r = nameMixCheck({
      knownChars: ['沈藏'],
      aliasMap: { 沈藏: ['沈爷'] },
      chapters: [
        ch('正文/第03章_码头.md', '沈爷说：“藏哥，等等我。”沈爷又说：“沈爷？不对，藏哥。”沈爷笑了。\n')
      ]
    })
    // 叙述层只有沈爷（一种称呼）→ 不报
    expect(r.items).toHaveLength(0)
  })

  it('反例：分段使用（先全部全名、再全部称谓，无来回）→ 不报', () => {
    const r = nameMixCheck({
      knownChars: ['陈默'],
      chapters: [ch('正文/第01章_雾港.md', '陈默进门。陈默脱外套。陈默坐下。陈师傅端茶。陈师傅退下。\n')]
    })
    expect(r.items).toHaveLength(0)
  })

  it('反例：偶发异称（交替 2 次以下，Beth Hill「一两次不值得」）→ 不报', () => {
    const r = nameMixCheck({
      knownChars: ['陈默'],
      chapters: [ch('正文/第01章_雾港.md', '陈默进门。陈师傅端茶。陈默喝完走了。\n')]
    })
    expect(r.items).toHaveLength(0)
  })

  it('反例：同姓双雄「陈师傅」归属不明 → 不报', () => {
    const r = nameMixCheck({
      knownChars: ['陈默', '陈航'],
      chapters: [ch('正文/第01章_雾港.md', '陈师傅推门。陈默抬头。陈师傅坐下。陈默开口。陈师傅打断了他。\n')]
    })
    expect(r.items).toHaveLength(0)
  })

  it('反例：单字名/无常见姓不参与 → 无可核查对象', () => {
    const r = nameMixCheck({ knownChars: ['阿七'], chapters: [ch('正文/第01章_雾港.md', '阿七在码头。七爷在船头。阿七上船。七爷也上。\n')] })
    expect(r.items).toHaveLength(0)
    expect(r.summary).toContain('没有可从名字识别出姓')
  })

  it('反例：三字人名不被「姓+单字」拆出（陈叔同≠陈叔 不误报）', () => {
    const r = nameMixCheck({
      knownChars: ['陈叔同'],
      chapters: [ch('正文/第01章_雾港.md', '陈叔同进门。陈叔同落座。陈叔同开口。\n')]
    })
    expect(r.items).toHaveLength(0)
  })

  it('反例：变体等于他人本名/别名 → 归属不明不报', () => {
    const r = nameMixCheck({
      knownChars: ['陈默', '陈师傅'],
      aliasMap: { 陈师傅: ['老陈'] },
      chapters: [ch('正文/第01章_雾港.md', '陈师傅推门。陈默抬头。陈师傅坐下。陈默开口。\n')]
    })
    // 「陈师傅」是他人本名 → 陈默声明「陈师傅」被排除；「老陈」是他人别名 → 排除 → 陈默只有全名一种 → 不报
    expect(r.items).toHaveLength(0)
  })

  it('反例：front matter 与 HTML 注释不计入', () => {
    const raw =
      `---\n章号: 1\n题名: 陈师傅\n涉及人物: [陈默]\n---\n` +
      '<!-- 陈师傅明明在注释里。老陈也在注释里。陈默提到了他们吗？提到了。 -->\n正文只有陈默。\n'
    const r = nameMixCheck({ knownChars: ['陈默'], chapters: [{ file: '正文/第01章_雾港.md', raw }] })
    expect(r.items).toHaveLength(0)
  })

  it('where 定位到具体章；what 带交替处上下文', () => {
    const r = nameMixCheck({
      knownChars: ['林西'],
      chapters: [
        ch('正文/第01章_雾港.md', '林老师先开口。'),
        ch('正文/第02章_灯下.md', '林西推门。林老师抬头。林西坐下。林老师开口。林西没有答话。\n')
      ]
    })
    expect(r.items).toHaveLength(1)
    expect(r.items[0].where).toContain('第02章')
    expect(r.items[0].what).toContain('交替处')
    expect(r.items[0].what).toContain('推门')
  })

  it('多章多人物各报一条', () => {
    const r = nameMixCheck({
      knownChars: ['陈默', '林西'],
      chapters: [
        ch('正文/第01章_雾港.md', '陈默进门。陈师傅端茶。陈默坐下。陈师傅退下。陈默笑了。\n'),
        ch('正文/第02章_灯下.md', '林西进门。林老师端茶。林西坐下。林老师退下。林西笑了。\n')
      ]
    })
    expect(r.items).toHaveLength(2)
  })

  it('空章节/无项目 → 空态', () => {
    const r = nameMixCheck({ knownChars: [], chapters: [] })
    expect(r.items).toHaveLength(0)
    expect(r.summary).toContain('没有可从名字识别出姓')
  })
})
