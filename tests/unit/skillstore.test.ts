import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// 写面（main/skills.ts）单测：settings.workspaceDir → 临时目录（真机路径决策由 settings 单测覆盖；
// 这里只测 main/skills.ts 的写盘与校验行为，与 store.test.ts「mkdtemp + 不碰真实项目库」同约定）。
const state = vi.hoisted(() => ({ root: '' }))
vi.mock('../../src/main/settings', () => ({ workspaceDir: () => state.root }))

import {
  listSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  setSkillDisabled,
  importSkill,
  exportSkill
} from '../../src/main/skills'

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'zj-skillstore-'))
})
afterEach(() => {
  rmSync(state.root, { recursive: true, force: true })
})

const DRAFT = {
  name: '倒叙开篇法',
  description: '从人物高光时刻落笔再回叙起因，制造悬念与代入感',
  whenToUse: '开篇或重写开头',
  triggers: ['倒叙', '开篇'],
  arguments: '[要点]',
  body: '步骤：\n1. 先写人物最高光的一幕\n2. 回叙起因'
}

function skillFile(name: string): string {
  return join(state.root, 'skills', name, 'SKILL.md')
}

describe('main/skills.ts 写面（设置管理数据链）', () => {
  it('createSkill：校验通过 + 目录不存在 → 写盘成功，listSkills 可见且字段 roundtrip', () => {
    const r = createSkill(DRAFT)
    expect(r).toEqual({ ok: true })
    expect(existsSync(skillFile('倒叙开篇法'))).toBe(true)
    const metas = listSkills()
    expect(metas).toHaveLength(1)
    expect(metas[0].name).toBe('倒叙开篇法')
    expect(metas[0].triggers).toEqual(['倒叙', '开篇'])
    expect(metas[0].body).toContain('最高光的一幕')
    expect(metas[0].disabled).toBeFalsy()
  })

  it('createSkill：重名 → error 且不覆盖', () => {
    createSkill(DRAFT)
    const r = createSkill({ ...DRAFT, body: '新正文' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('已存在')
    expect(readFileSync(skillFile('倒叙开篇法'), 'utf-8')).toContain('最高光的一幕')
  })

  it('createSkill：name 非法（路径穿越）→ error 且不建目录', () => {
    const r = createSkill({ ...DRAFT, name: '../../逃逸' })
    expect(r.ok).toBe(false)
    // 校验在 mkdir 之前拦截：skills/ 根目录都不应被创建
    expect(existsSync(join(state.root, 'skills'))).toBe(false)
  })

  it('createSkill：description 缺失 → error', () => {
    const r = createSkill({ ...DRAFT, description: '  ' })
    expect(r.ok).toBe(false)
  })

  it('updateSkill：更新内容并保留 name；改名 → error；不存在 → error', () => {
    createSkill(DRAFT)
    const r = updateSkill('倒叙开篇法', { ...DRAFT, description: '新描述', body: '新正文' })
    expect(r).toEqual({ ok: true })
    const m = listSkills()[0]
    expect(m.description).toBe('新描述')
    expect(m.body).toBe('新正文')
    const r2 = updateSkill('倒叙开篇法', { ...DRAFT, name: '新名', body: 'x' })
    expect(r2.ok).toBe(false)
    const r3 = updateSkill('不存在', DRAFT)
    expect(r3.ok).toBe(false)
  })

  it('setSkillDisabled：true 写行 false 删行，文本级保真', () => {
    createSkill(DRAFT)
    expect(setSkillDisabled('倒叙开篇法', true)).toEqual({ ok: true })
    expect(listSkills()[0].disabled).toBe(true)
    expect(readFileSync(skillFile('倒叙开篇法'), 'utf-8')).toContain('disabled: true')
    expect(setSkillDisabled('倒叙开篇法', false)).toEqual({ ok: true })
    expect(listSkills()[0].disabled).toBeFalsy()
    expect(readFileSync(skillFile('倒叙开篇法'), 'utf-8')).not.toContain('disabled:')
  })

  it('deleteSkill：目录（含 references）被删；再删 → error', () => {
    createSkill(DRAFT)
    const ref = join(state.root, 'skills', '倒叙开篇法', 'references')
    mkdtempSync(ref)
    expect(deleteSkill('倒叙开篇法')).toEqual({ ok: true })
    expect(existsSync(join(state.root, 'skills', '倒叙开篇法'))).toBe(false)
    expect(listSkills()).toHaveLength(0)
    expect(deleteSkill('倒叙开篇法').ok).toBe(false)
  })

  it('importSkill：标准子集（仅 name/description）→ 成功；重名/非法/非 SKILL.md → error', () => {
    const std = '---\nname: namesake-note\ndescription: 名字命名法：什么角色叫什么名，Use when naming characters\n---\n\n步骤：\n1. 按身份定姓\n'
    expect(importSkill(std)).toEqual({ ok: true })
    const m = listSkills().find((s) => s.name === 'namesake-note')!
    expect(m.description).toContain('命名')
    expect(importSkill(std).ok).toBe(false)
    const bad = '---\nname: a/b\ndescription: x\n---\nbody'
    expect(importSkill(bad).ok).toBe(false)
    expect(importSkill('没有约定头').ok).toBe(false)
  })

  it('exportSkill：导出原文含 name/description/正文；不存在 → error', () => {
    createSkill(DRAFT)
    const r = exportSkill('倒叙开篇法')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toContain('name: 倒叙开篇法')
      expect(r.text).toContain('description:')
      expect(r.text).toContain('最高光的一幕')
    }
    expect(exportSkill('不存在').ok).toBe(false)
  })
})
