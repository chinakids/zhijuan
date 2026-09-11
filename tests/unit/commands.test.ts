import { describe, expect, it } from 'vitest'
import { ALL_COMMANDS, BUILTIN_COMMANDS, FIXED_COMMANDS, expandCommand, filterCommandCandidates, insertCommand, matchFixedCommand, parseCommandTrigger } from '../../src/shared/commands'

describe('parseCommandTrigger（/ 命令触发解析）', () => {
  it('行首 / 触发（无 query）', () => {
    expect(parseCommandTrigger('/', 1)).toEqual({ at: 0, length: 0, query: '' })
  })

  it('空白前 / 触发并取到 token', () => {
    expect(parseCommandTrigger('帮我 /续写 一下', '帮我 /续写'.length)).toEqual({ at: 3, length: 2, query: '续写' })
  })

  it('/ 前是汉字/字母（a/b 路径）不触发', () => {
    expect(parseCommandTrigger('abc/def', 7)).toBeNull()
    expect(parseCommandTrigger('正文/第01章', '正文/第01章'.length)).toBeNull()
  })

  it('token 含空白不触发（/ 后已输入参数）', () => {
    expect(parseCommandTrigger('/续写 三百字', 4)).toBeNull()
  })

  it('token 超 30 字符不触发', () => {
    const tok = 'x'.repeat(31)
    expect(parseCommandTrigger('/' + tok, 1 + tok.length)).toBeNull()
    expect(parseCommandTrigger('/' + 'x'.repeat(30), 31)).not.toBeNull()
  })

  it('多个 / 取最近的', () => {
    expect(parseCommandTrigger('/续写 和 /润色', '/续写 和 /润色'.length)).toEqual({ at: 6, length: 2, query: '润色' })
  })

  it('换行前 / 也算行首触发', () => {
    expect(parseCommandTrigger('第一行\n/续', '第一行\n/续'.length)).toEqual({ at: 4, length: 1, query: '续' })
  })
})

describe('filterCommandCandidates（命令过滤）', () => {
  it('query 为空全出（模板 + 固定逻辑）', () => {
    expect(filterCommandCandidates('')).toHaveLength(ALL_COMMANDS.length)
    expect(ALL_COMMANDS.filter((c) => c.kind === 'action').map((c) => c.name)).toEqual(['巡查', '导演'])
  })

  it('按名称包含过滤', () => {
    expect(filterCommandCandidates('续').map((c) => c.name)).toEqual(['续写'])
  })

  it('按说明包含过滤', () => {
    expect(filterCommandCandidates('走向').map((c) => c.name)).toEqual(['延伸'])
  })

  it('无匹配返回空', () => {
    expect(filterCommandCandidates('不存在')).toEqual([])
  })
})

describe('insertCommand（替换触发区间为 /命令名 ）', () => {
  it('行首空 query 替换', () => {
    const r = insertCommand('/', { at: 0, length: 0 }, BUILTIN_COMMANDS[0])
    expect(r.value).toBe('/续写 ')
    expect(r.caret).toBe('/续写 '.length)
  })

  it('行中替换且光标落在命令后', () => {
    const r = insertCommand('帮我 /续 一下', { at: 3, length: 1 }, BUILTIN_COMMANDS[0])
    expect(r.value).toBe('帮我 /续写 一下')
    // 原「/续」后是空格，repl 不再补空格，光标在命令名后
    expect(r.caret).toBe('帮我 /续写'.length)
  })

  it('命令名后紧跟空白不产生双空格', () => {
    const r = insertCommand('/续 300字', { at: 0, length: 1 }, BUILTIN_COMMANDS[0])
    expect(r.value).toBe('/续写 300字')
    expect(r.caret).toBe('/续写'.length)
  })
})

describe('expandCommand（命令展开为模板 prompt）', () => {
  it('非命令（无 / 开头）返回 null', () => {
    expect(expandCommand('续写一下', '雾港')).toBeNull()
  })

  it('命令名不存在返回 null', () => {
    expect(expandCommand('/不存在 参数', '雾港')).toBeNull()
  })

  it('纯命令无参数展开，标题插值', () => {
    const p = expandCommand('/续写', '雾港')!
    expect(p).toContain('续写《雾港》正文')
    expect(p).toContain('zj_edit_doc')
    expect(p).not.toContain('具体要求')
  })

  it('带参数展开，参数拼进模板', () => {
    const p = expandCommand('/续写 三百字，带出沈藏', '雾港')!
    expect(p).toContain('具体要求：三百字，带出沈藏')
  })

  it('标题为空回退「当前章」', () => {
    const p = expandCommand('/润色', '')!
    expect(p).toContain('润色《当前章》正文')
  })

  it('延伸命令不含修改卡口径（不写正文）', () => {
    const p = expandCommand('/延伸 反派动机', '雾港')!
    expect(p).toContain('3 个可发展的走向')
    expect(p).toContain('聚焦：反派动机')
    expect(p).not.toContain('zj_edit_doc')
  })
})

describe('matchFixedCommand（固定逻辑命令识别）', () => {
  it('识别 /巡查 与 /导演（无参）', () => {
    expect(matchFixedCommand('/巡查')?.cmd.name).toBe('巡查')
    expect(matchFixedCommand('/导演')?.cmd.name).toBe('导演')
  })

  it('带参数解析并去空白', () => {
    const r = matchFixedCommand('/巡查 修订')
    expect(r?.cmd.run).toBe('chapterCheck')
    expect(r?.args).toBe('修订')
    expect(matchFixedCommand('  /导演  要快 ')?.args).toBe('要快')
  })

  it('模板命令/未知命令/非行首/命令名前缀不匹配', () => {
    expect(matchFixedCommand('/续写 三百字')).toBeNull()
    expect(matchFixedCommand('/不存在 参数')).toBeNull()
    expect(matchFixedCommand('帮我 /巡查')).toBeNull()
    expect(matchFixedCommand('/巡查中 检查')).toBeNull()
  })

  it('无参数返回空串', () => {
    expect(matchFixedCommand('/巡查')?.args).toBe('')
  })

  it('固定命令不走进模板展开（expandCommand 返回 null）', () => {
    expect(expandCommand('/导演', '雾港')).toBeNull()
    expect(FIXED_COMMANDS.map((c) => c.name)).toEqual(['巡查', '导演'])
  })
})
