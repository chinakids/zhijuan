// skill 设置管理 · 数据层冒烟（真机 main/skills.ts bundle，真实写盘到临时工作区）
// 验证：create/update/delete/setDisabled/import/export 六写面 + listSkills 扫描 + 错误分支。
// 用法：cd ~/Desktop/织卷 && node scripts/skill-manage-smoke.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
// 干净 userData + 设置 workspace 指向临时工作区（不碰真实 织卷工作区；readSettings 在模块加载时读盘）
const ud = '/tmp/zj-smoke-skillmgr'
const ws = ud + '/ws'
rmSync(ud, { recursive: true, force: true })
mkdirSync(ud, { recursive: true })
writeFileSync(ud + '/zhijuan-settings.json', JSON.stringify({ workspace: ws }))
process.env.ZJ_USERDATA = ud

const out = '/tmp/skill-manage-bundle.mjs'
await esbuild({
  stdin: {
    contents: `export { listSkills, createSkill, updateSkill, deleteSkill, setSkillDisabled, importSkill, exportSkill } from ${JSON.stringify(
      resolve(root, 'src/main/skills.ts')
    )};`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})

const w = await import(pathToFileURL(out).href)

let pass = 0
const fail = (name) => {
  console.error('  ✗ 断言失败: ' + name)
  process.exit(1)
}
const assert = (name, cond) => {
  if (!cond) fail(name)
  pass++
  console.log('  ✓ ' + name)
}

const fileName = (name) => `${ws}/skills/${name}/SKILL.md`
const DRAFT = {
  name: '倒叙开篇法',
  description: '从人物高光时刻落笔再回叙起因，制造悬念与代入感',
  whenToUse: '开篇或重写开头，想用倒叙制造悬念时',
  triggers: ['倒叙', '开篇'],
  arguments: '[要点]',
  body: '步骤：\n1. 先写人物最高光的一幕\n2. 回叙中埋下呼应细节'
}

console.log('=== skill 设置管理（真机写面）===')
assert('初始空清单', w.listSkills().length === 0)

// create
assert('create ok', w.createSkill(DRAFT).ok === true)
assert('SKILL.md 落盘', existsSync(fileName('倒叙开篇法')))
assert('list 可见且 roundtrip 字段', (() => {
  const m = w.listSkills().find((s) => s.name === '倒叙开篇法')
  return m && m.triggers.join(',') === '倒叙,开篇' && m.body.includes('最高光的一幕') && !m.disabled
})())
assert('create 重名 error', (() => {
  const r = w.createSkill({ ...DRAFT, body: 'x' })
  return !r.ok && r.error.includes('已存在')
})())
assert('create 非法名 error 且无目录', (() => {
  const r = w.createSkill({ ...DRAFT, name: 'a/b' })
  return !r.ok && r.error.includes('不合法')
})())

// update
assert('update ok（改描述与正文）', (() => {
  const r = w.updateSkill('倒叙开篇法', { ...DRAFT, description: '新描述', body: '新正文' })
  if (!r.ok) return false
  const m = w.listSkills().find((s) => s.name === '倒叙开篇法')
  return m.description === '新描述' && m.body === '新正文'
})())
assert('update 改名 error', !w.updateSkill('倒叙开篇法', { ...DRAFT, name: '新名', body: 'x' }).ok)

// setDisabled（文本级保真）
assert('禁用 → disabled: true 行写入', (() => {
  const r = w.setSkillDisabled('倒叙开篇法', true)
  return r.ok && readFileSync(fileName('倒叙开篇法'), 'utf-8').includes('disabled: true') && w.listSkills()[0].disabled === true
})())
assert('解禁 → 行删除且他人他行保留', (() => {
  const r = w.setSkillDisabled('倒叙开篇法', false)
  const text = readFileSync(fileName('倒叙开篇法'), 'utf-8')
  return r.ok && !text.includes('disabled:') && text.includes('name: 倒叙开篇法') && text.includes('新描述')
})())

// export / import
assert('export 原文含 name/description/正文', (() => {
  const r = w.exportSkill('倒叙开篇法')
  return r.ok && r.text.includes('name: 倒叙开篇法') && r.text.includes('新描述') && r.text.includes('新正文')
})())
assert('export 不存在 error', !w.exportSkill('幽灵技能').ok)
const STD = '---\nname: namesake-note\ndescription: 名字命名法：按身份定姓，Use when naming characters\n---\n\n步骤：\n1. 按身份定姓\n'
assert('import 标准子集成功', w.importSkill(STD).ok === true)
assert('import 后 list 可见', (() => {
  const m = w.listSkills().find((s) => s.name === 'namesake-note')
  return m && m.description.includes('命名') && m.body.includes('按身份定姓')
})())
assert('import 重名 error', !w.importSkill(STD).ok)
assert('import 非 SKILL.md error', !w.importSkill('没有约定头').ok)
assert('import 路径穿越 name error', (() => {
  const r = w.importSkill('---\nname: a/b\ndescription: x\n---\nbody')
  return !r.ok && r.error.includes('不合法')
})())

// delete
assert('delete ok + 目录消失', (() => {
  const r = w.deleteSkill('倒叙开篇法')
  return r.ok && !existsSync(ws + '/skills/倒叙开篇法') && w.listSkills().length === 1 && w.listSkills()[0].name === 'namesake-note'
})())
assert('delete 再删 error', !w.deleteSkill('倒叙开篇法').ok)

console.log(`\n=== 结果: ${pass} 断言全过 ===`)
process.exit(0)
