// 织卷 · 真模型「技能运行层」探针（2026-09-21 12:00 智能层轮；设计基线 §7）
// 场景：A 触发词自动激活「倒叙开篇法」；B 显式 /倒叙开篇法 调用；C disabled 技能不激活（负面）。
// 判据（行为面）：A/B 最终回复体现技能正文步骤（「最高光/回叙/呼应」）且不声称没听过该技能；
//            C 回复不含禁用技能正文的独特词。数据层：listSkills 解析/目录名一致性/disabled 保持。
// 用法：cd ~/Desktop/织卷 && node scripts/skill-live.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
/** 只跑指定场景（SKILL_LIVE_CASE=A|B|C；默认全跑三场景） */
const only = (process.env.SKILL_LIVE_CASE || '').toUpperCase()
const tmp = mkdtempSync(join(tmpdir(), 'zj-skilllive-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
const ws = join(tmp, 'ws')
const lib = join(tmp, 'lib')
writeFileSync(
  join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'),
  JSON.stringify({ libraryRoot: lib, workspace: ws }),
  'utf-8'
)

// 工作区技能种子：倒叙开篇法（正例）+ 禁用技能（disabled）+ 目录名不一致（invalid 示例）
const sk1 = join(ws, 'skills/倒叙开篇法')
mkdirSync(sk1, { recursive: true })
writeFileSync(
  join(sk1, 'SKILL.md'),
  [
    '---',
    'name: 倒叙开篇法',
    'description: 从人物高光时刻落笔再回叙起因，制造悬念与代入感',
    'when_to_use: 开篇或重写开头，想用倒叙制造悬念时',
    'triggers: [倒叙, 开篇]',
    'arguments: [要点]',
    '---',
    '',
    '遵循以下步骤：',
    '1. 先写人物最高光的一幕（结果/冲突顶点），用一句留白切回起因',
    '2. 回叙中埋下与高光呼应的细节（物象、台词、天气）',
    '3. 结尾回到高光时刻，用一个动作收束，不做解释',
    '',
    '更多例子见 references/示例.md。',
    ''
  ].join('\n'),
  'utf-8'
)
mkdirSync(join(sk1, 'references'), { recursive: true })
writeFileSync(
  join(sk1, 'references/示例.md'),
  ['# 倒叙开篇法 · 示例', '', '「灯塔已经熄了。三天前的夜里，他在这条船上接过一只皮箱。」', '', '（示例正文，技能正文引用它时应直接可读）'].join('\n'),
  'utf-8'
)
const sk2 = join(ws, 'skills/禁用技能')
mkdirSync(sk2, { recursive: true })
writeFileSync(
  join(sk2, 'SKILL.md'),
  ['---', 'name: 禁用技能', 'description: 演示禁用', 'triggers: [禁用触发]', 'disabled: true', '---', '', '禁用技能专属正文：五感白描要并列三层感官。'].join('\n'),
  'utf-8'
)
const sk3 = join(ws, 'skills/名称不符')
mkdirSync(sk3, { recursive: true })
writeFileSync(
  join(sk3, 'SKILL.md'),
  ['---', 'name: 另一个名字', 'description: 目录名与 name 不一致', '---', '', '不应生效。'].join('\n'),
  'utf-8'
)

// ---- 第一段：数据层（bundle main/skills.ts）----
const skOut = join(tmp, 'skills-bundle.mjs')
await esbuild({
  entryPoints: [resolve(root, 'src/main/skills.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: skOut,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})
const skMod = await import(pathToFileURL(skOut).href)
const listed = skMod.listSkills()
const byName = Object.fromEntries(listed.map((s) => [s.name, s]))
const dataChecks = {
  '扫到倒叙开篇法': !!byName['倒叙开篇法'],
  '解析出触发词': JSON.stringify(byName['倒叙开篇法']?.triggers) === JSON.stringify(['倒叙', '开篇']),
  '解析出 arguments': byName['倒叙开篇法']?.arguments === '[要点]',
  '正文含步骤': (byName['倒叙开篇法']?.body ?? '').includes('最高光的一幕'),
  'disabled 技能保留 disabled': byName['禁用技能']?.disabled === true,
  '目录名不一致标记 invalid': !!byName['另一个名字']?.invalid && byName['另一个名字']?.name === '另一个名字'
}
let dataPass = true
for (const [k, v] of Object.entries(dataChecks)) {
  console.log(`断言 ${k}: ${v ? 'OK' : 'FAIL'}`)
  if (!v) dataPass = false
}
if (dataPass) console.log('SKILL-DATA OK')

// ---- 第二段：真模型行为（bundle engine.ts 的 runChat）----
const pid = '技能探针项目'
const P = (rel) => join(lib, pid, rel)
mkdirSync(P('正文'), { recursive: true })
mkdirSync(P('人物'), { recursive: true })
writeFileSync(
  P('正文/第01章_夜航.md'),
  ['---', '章号: 1', '题名: 夜航', '切片: 第一幕', '涉及人物: []', '---', '', '轮船靠岸的时候已经是后半夜。他沿着栈桥往码头深处走，浪声很大。', '', '他靠在小艇上，望着港口。', ''].join('\n'),
  'utf-8'
)

const out = join(tmp, 'engine-bundle.mjs')
await esbuild({
  entryPoints: [resolve(root, 'src/main/agent/engine.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})
const mod = await import(pathToFileURL(out).href)

async function runCase(label, prompt) {
  const events = []
  console.log(`\n=== ${label} 开始：`, new Date().toISOString())
  await mod.runChat(
    {
      requestId: 'skill-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      projectId: pid,
      chapterRel: '正文/第01章_夜航.md',
      chapterTitle: '第1章',
      prompt,
      quote: null
    },
    (e) => {
      events.push(e)
      if (e.type === 'delta') process.stdout.write(e.text)
      else if (e.type === 'meta') console.log('\n[工具]', e.tool, JSON.stringify(e.args ?? '').slice(0, 60))
      else if (e.type === 'error') console.error('\n[错误]', e.message)
    }
  )
  const final = events.filter((e) => e.type === 'final').map((e) => e.text).join('\n')
  console.log(`\n=== ${label} 完成，最终回复：\n` + final)
  return final
}

const finalA = only === '' || only === 'A' ? await runCase('场景A(触发词自动激活)', '帮我按倒叙开篇法写故事开头，写 3 句就行。') : ''
const finalB = only === '' || only === 'B' ? await runCase('场景B(显式 /倒叙开篇法)', '/倒叙开篇法 要点：先写他被雨困在候船厅的一幕') : ''
const finalC = only === '' || only === 'C' ? await runCase('场景C(disabled 不激活·负面)', '帮我用禁用触发的方法写一段五感描写。') : ''

await mod.shutdown()

const methodWords = /最高光|回叙|呼应|高光/
const checks = [
  ['A 回复体现技能步骤(最高光/回叙/呼应/高光)', only !== '' && only !== 'A' ? true : methodWords.test(finalA)],
  ['A 不声称没听过该技能', only !== '' && only !== 'A' ? true : !/没听过|没有这个技能|不知道.*倒叙/.test(finalA)],
  ['B 显式调用同样体现步骤', only !== '' && only !== 'B' ? true : methodWords.test(finalB)],
  ['C 不含禁用技能独特词(五感白描并列三层)', only !== '' && only !== 'C' ? true : !/并列三层感官/.test(finalC)]
]
let livePass = true
for (const [name, ok] of checks) {
  console.log(`断言 ${name}: ${ok ? 'OK' : 'FAIL'}`)
  if (!ok) livePass = false
}

console.log('\n' + (dataPass && livePass ? 'SKILL-LIVE OK' : 'SKILL-LIVE FAILED'))
rmSync(tmp, { recursive: true, force: true })
process.exit(dataPass && livePass ? 0 : 1)
