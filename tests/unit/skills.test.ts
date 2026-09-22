import { describe, expect, it } from 'vitest'
import {
  parseSkillFile,
  validateSkillDir,
  skillListing,
  skillBodyBlock,
  matchSkillForInput,
  matchExplicitSkill,
  skillCommandOf,
  resolveSkillInjection,
  skillNameValid,
  validateSkillDraft,
  renderSkillFile,
  type SkillMeta
} from '../../src/shared/skills'
import { filterCommandCandidates } from '../../src/shared/commands'

const RAW = `---
name: 倒叙开篇法
description: 从人物高光时刻落笔再回叙起因，制造悬念与代入感
when_to_use: 开篇或重写开头
triggers: [倒叙, 开篇]
arguments: [要点]
---

步骤：
1. 先写人物最高光的一幕
`

describe('parseSkillFile（SKILL.md 解析）', () => {
  it('合法文件：解析出 name/description/triggers/arguments/body', () => {
    const m = parseSkillFile(RAW)!
    expect(m.name).toBe('倒叙开篇法')
    expect(m.description).toContain('高光时刻')
    expect(m.triggers).toEqual(['倒叙', '开篇'])
    expect(m.arguments).toBe('[要点]')
    expect(m.body).toContain('先写人物最高光的一幕')
    expect(m.disabled).toBeFalsy()
  })

  it('triggers 空格分隔字符串也解析成数组', () => {
    const m = parseSkillFile('---\nname: a\ndescription: b\ntriggers: 倒叙 开篇\n---\nbody')
    expect(m!.triggers).toEqual(['倒叙', '开篇'])
  })

  it('缺 name 返回 null', () => {
    expect(parseSkillFile('---\ndescription: 只有描述\n---\nbody')).toBeNull()
  })

  it('缺 description 返回 null', () => {
    expect(parseSkillFile('---\nname: 只有名字\n---\nbody')).toBeNull()
  })

  it('无 front matter 返回 null', () => {
    expect(parseSkillFile('没有约定头的纯文本')).toBeNull()
  })

  it('disabled: true 解析为 true', () => {
    const m = parseSkillFile('---\nname: a\ndescription: b\ndisabled: true\n---\nbody')
    expect(m!.disabled).toBe(true)
  })

  it('未知字段（license 等）忽略不报错', () => {
    const m = parseSkillFile('---\nname: a\ndescription: b\nlicense: MIT\nmetadata: {x: 1}\n---\nbody')
    expect(m).not.toBeNull()
    expect(m!.body).toBe('body')
  })
})

describe('validateSkillDir（目录名=name 一致性）', () => {
  it('一致=合法', () => {
    const m = parseSkillFile(RAW)!
    expect(validateSkillDir(m, '倒叙开篇法')).toBe(true)
    expect(m.invalid).toBeUndefined()
  })
  it('不一致=不生效并置 invalid 原因', () => {
    const m = parseSkillFile(RAW)!
    expect(validateSkillDir(m, '别的目录')).toBe(false)
    expect(m.invalid).toContain('不一致')
  })
})

const mk = (over: Partial<SkillMeta>): SkillMeta => ({
  name: '技能',
  description: '描述',
  dir: '技能',
  body: '正文',
  ...over
})

describe('skillListing（清单块+渐进披露预算）', () => {
  it('生成清单：行格式=名+描述（含触发词）', () => {
    const out = skillListing([mk({ name: '倒叙开篇法', description: '从高光落笔', triggers: ['倒叙'] })], 120, 600)!
    expect(out).toContain('【可用技能】')
    expect(out).toContain('- 倒叙开篇法：从高光落笔（触发词：倒叙）')
  })

  it('单行超预算→截断（perLine）', () => {
    const long = '长'.repeat(200)
    const out = skillListing([mk({ name: 'n', description: long })], 120, 6000)!
    const line = out.split('\n')[1]
    expect(line!.length).toBeLessThanOrEqual(120)
  })

  it('清单超总预算→降级 name-only', () => {
    // 每行 perLine=120 截断，6 个技能=720 > total 600 → 降级（描述不再进上下文）
    const skills = Array.from({ length: 6 }, (_, i) => mk({ name: '技能' + i, description: '描述'.repeat(200) }))
    const out = skillListing(skills, 120, 600)!
    const rows = out.split('\n').slice(1)
    expect(rows.every((r) => /^- 技能\d$/.test(r))).toBe(true)
  })

  it('disabled 技能不出现在清单；全部禁用→null', () => {
    expect(skillListing([mk({ disabled: true })], 120, 600)).toBeNull()
  })

  it('无技能→null', () => {
    expect(skillListing([], 120, 600)).toBeNull()
  })
})

describe('matchSkillForInput（关键词自动匹配）', () => {
  const skills = [
    mk({ name: '倒叙开篇法', description: '从人物高光时刻落笔再回叙起因', triggers: ['倒叙', '开篇'] }),
    mk({ name: '命名法', description: '依据时代与身份给人物起名，规避穿越感' }),
    mk({ name: '禁用技能', description: '这本不该被激活', triggers: ['禁用触发'], disabled: true })
  ]

  it('触发词命中（出现即中）', () => {
    const m = matchSkillForInput('帮我用倒叙开篇，写新的开头', skills)
    expect(m.map((s) => s.name)).toEqual(['倒叙开篇法'])
  })

  it('无触发词时描述相似度命中（2-gram 重叠）', () => {
    const m = matchSkillForInput('按人物高光时刻落笔来写', skills)
    expect(m.map((s) => s.name)).toContain('倒叙开篇法')
  })

  it('多命中按命中数排序且 ≤2 条', () => {
    const many = [
      mk({ name: 'A', description: '雨夜的离别场景写法，气氛与留白' }),
      mk({ name: 'B', description: '雨夜离别时的对白处理' }),
      mk({ name: 'C', description: '雨夜离别如何收束' }),
      mk({ name: 'D', description: '完全无关的天气描写要点' })
    ]
    const m = matchSkillForInput('这个雨夜离别的场景怎么写', many)
    expect(m.length).toBeLessThanOrEqual(2)
  })

  it('disabled 不参与匹配', () => {
    expect(matchSkillForInput('用禁用触发来做', skills)).toHaveLength(0)
  })

  it('无命中返回空', () => {
    expect(matchSkillForInput('检查一下错别字', [mk({ name: 'x', description: '雨雪天气' })])).toHaveLength(0)
  })
})

describe('matchExplicitSkill（/技能名 显式调用）', () => {
  const skills = [mk({ name: '倒叙开篇法', dir: '倒叙开篇法' }), mk({ name: '禁用技能', disabled: true })]
  it('命中并提取参数', () => {
    const r = matchExplicitSkill('/倒叙开篇法 重点是气氛', skills)
    expect(r).not.toBeNull()
    expect(r!.skill.name).toBe('倒叙开篇法')
    expect(r!.args).toBe('重点是气氛')
  })
  it('未命中（非技能名）返回 null', () => {
    expect(matchExplicitSkill('/续写 300 字', skills)).toBeNull()
    expect(matchExplicitSkill('普通消息', skills)).toBeNull()
  })
  it('disabled 技能显式调用也不生效', () => {
    expect(matchExplicitSkill('/禁用技能 试试', skills)).toBeNull()
  })
})

describe('skillBodyBlock（激活注入块）', () => {
  it('生成【技能：名】块并拼参数', () => {
    const b = skillBodyBlock(mk({ name: '倒叙开篇法', body: '步骤一\n步骤二' }), '要点：气氛')
    expect(b).toContain('【技能：倒叙开篇法】')
    expect(b).toContain('步骤一')
    expect(b).toContain('（参数：要点：气氛）')
  })
  it('超预算=保头+注明现读', () => {
    const long = '本'.repeat(3200)
    const b = skillBodyBlock(mk({ name: 'a', body: long }), undefined, 3000)
    expect(b.length).toBeLessThan(3300)
    expect(b).toContain('已省略 200 字符')
    expect(b).toContain('zj_read_doc')
  })
})

describe('skillCommandOf + filterCommandCandidates（/ 槽位合并）', () => {
  it('技能命令进入候选（kind=skill，含 argHint）', () => {
    const cmd = skillCommandOf(mk({ name: '倒叙开篇法', description: '从高光落笔', arguments: '[要点]' }))
    expect(cmd.kind).toBe('skill')
    const items = filterCommandCandidates('', [cmd])
    expect(items.some((c) => c.id === 'skill:倒叙开篇法')).toBe(true)
  })
  it('与内置同名=内置在前（技能仍列出并标注，不遮蔽）', () => {
    const dup = skillCommandOf(mk({ name: '续写', description: '同名技能' }))
    const items = filterCommandCandidates('', [dup])
    const x = items.filter((c) => c.name === '续写')
    expect(x).toHaveLength(2)
    expect(x[0].kind).toBe('template') // 内置在前
    expect(x[1].kind).toBe('skill')
  })
  it('query 过滤技能命令', () => {
    const cmd = skillCommandOf(mk({ name: '倒叙开篇法', description: '从高光落笔' }))
    const items = filterCommandCandidates('倒叙', [cmd])
    expect(items.some((c) => c.kind === 'skill')).toBe(true)
    expect(filterCommandCandidates('不存在', [cmd]).some((c) => c.kind === 'skill')).toBe(false)
  })
})

describe('resolveSkillInjection（runChat 注入组装）', () => {
  const skills = [
    mk({ name: '倒叙开篇法', description: '从人物高光时刻落笔再回叙起因', triggers: ['倒叙', '开篇'], body: '步骤：最高光→回叙' }),
    mk({ name: '禁用技能', description: '禁', triggers: ['禁用触发'], disabled: true })
  ]
  it('触发词自动激活：注入技能块且用户消息原样', () => {
    const r = resolveSkillInjection(skills, '帮我按倒叙开篇法写开头', '引用段落')
    expect(r.blocks.length).toBe(1)
    expect(r.blocks[0]).toContain('【技能：倒叙开篇法】')
    expect(r.blocks[0]).toContain('最高光')
    expect(r.userPrompt).toBe('帮我按倒叙开篇法写开头')
    expect(r.explicit).toBe(false)
  })
  it('显式调用：注入技能块+斜杠命令替换为技能指令', () => {
    const r = resolveSkillInjection(skills, '/倒叙开篇法 要点：先写雨夜', null)
    expect(r.blocks[0]).toContain('【技能：倒叙开篇法】')
    expect(r.blocks[0]).toContain('（参数：要点：先写雨夜）')
    expect(r.userPrompt).toContain('（按技能《倒叙开篇法》执行）')
    expect(r.userPrompt).toContain('先写雨夜')
    expect(r.userPrompt.startsWith('/')).toBe(false)
    expect(r.explicit).toBe(true)
  })
  it('disabled 技能不激活（显式也不生效）', () => {
    const r = resolveSkillInjection(skills, '/禁用技能 试试', null)
    expect(r.blocks).toHaveLength(0)
    expect(r.userPrompt).toBe('/禁用技能 试试')
    expect(r.explicit).toBe(false)
  })
  it('无命中：零块、消息原样', () => {
    const r = resolveSkillInjection(skills, '检查错别字', null)
    expect(r.blocks).toHaveLength(0)
    expect(r.userPrompt).toBe('检查错别字')
    expect(r.explicit).toBe(false)
  })
})

describe('skillNameValid（技能名=目录名合法）', () => {
  it('合法：中文/英文/数字/连字符/空格', () => {
    expect(skillNameValid('倒叙开篇法')).toBe(true)
    expect(skillNameValid('backstory-3got')).toBe(true)
    expect(skillNameValid('abc123')).toBe(true)
    expect(skillNameValid('名字 带 空格')).toBe(true)
  })
  it('非法：空/空白/以点开头/路径分隔/冒号/控制字符/超长', () => {
    expect(skillNameValid('')).toBe(false)
    expect(skillNameValid('   ')).toBe(false)
    expect(skillNameValid('.隐藏')).toBe(false)
    expect(skillNameValid('a/b')).toBe(false)
    expect(skillNameValid('a\\b')).toBe(false)
    expect(skillNameValid('a:b')).toBe(false)
    expect(skillNameValid('a\nb')).toBe(false)
    expect(skillNameValid('x'.repeat(65))).toBe(false)
  })
})

describe('validateSkillDraft（写面草稿校验）', () => {
  const ok = { name: '倒叙开篇法', description: '做什么+何时用', body: '步骤' }
  it('合法草稿通过', () => {
    expect(validateSkillDraft(ok)).toBeNull()
  })
  it('name 非法 → 错误', () => {
    expect(validateSkillDraft({ ...ok, name: 'a/b' })).toContain('不合法')
  })
  it('description 缺失/全空白 → 错误；超 500 → 错误', () => {
    expect(validateSkillDraft({ ...ok, description: '' })).toContain('必填')
    expect(validateSkillDraft({ ...ok, description: '   ' })).toContain('必填')
    expect(validateSkillDraft({ ...ok, description: '长'.repeat(501) })).toContain('超长')
  })
})

describe('renderSkillFile（SKILL.md 生成，roundtrip 保真）', () => {
  it('全字段：可被 parseSkillFile 原样解析且字段一致', () => {
    const text = renderSkillFile({
      name: '倒叙开篇法',
      description: '从人物高光时刻落笔再回叙起因',
      whenToUse: '开篇或重写开头',
      triggers: ['倒叙', '开篇'],
      arguments: '[要点]',
      body: '步骤：\n1. 最高光一幕'
    })
    const m = parseSkillFile(text)!
    expect(m.name).toBe('倒叙开篇法')
    expect(m.description).toBe('从人物高光时刻落笔再回叙起因')
    expect(m.whenToUse).toBe('开篇或重写开头')
    expect(m.triggers).toEqual(['倒叙', '开篇'])
    expect(m.arguments).toBe('[要点]')
    expect(m.body).toContain('1. 最高光一幕')
    expect(m.disabled).toBeFalsy()
  })
  it('可选字段缺省不写行；triggers 序列化为 [a, b]；disabled true 写行', () => {
    const text = renderSkillFile({ name: 'a', description: 'b', body: '' })
    expect(text).not.toContain('when_to_use')
    expect(text).not.toContain('triggers')
    expect(text).not.toContain('disabled')
    const t2 = renderSkillFile({ name: 'a', description: 'b', triggers: ['x', 'y'], disabled: true, body: '' })
    expect(t2).toContain('triggers: [x, y]')
    expect(t2).toContain('disabled: true')
  })
  it('body 前后空白剥离；front matter 与正文间隔一个空行', () => {
    const text = renderSkillFile({ name: 'a', description: 'b', body: '\n\n正文\n\n' })
    expect(text).toContain('---\n\n正文\n')
    const m = parseSkillFile(text)!
    expect(m.body).toBe('正文')
  })
})
