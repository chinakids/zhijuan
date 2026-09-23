// 织卷 · 真模型端到端走查——「涉及人物超 4 位时名单补充块」（无 GUI）
// 场景：第 2 章涉及人物 5 位（林晚/周守/顾知远/苏禾/第五），档案只附前 4 位（预算 CAP.maxChars=4），
//       上下文应含「【涉及人物补充】共 5 位：…」块——模型只凭上下文就能答出全部 5 位名单。
//       修复前（2026-09-10）：第 5 位被静默裁掉，模型只会知道前 4 位（多人局伤创作正确性）。
// 走查目标：真模型 runChat 第 2 章，只凭上下文回答「本章涉及人物有哪几位」→ 全部 5 位列出。
// 用法：cd ~/Desktop/织卷 && node scripts/context-cast-smoke.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-cast-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeProbeSettings({ libraryRoot: join(tmp, 'lib') })

const lib = join(tmp, 'lib')
const pid = '走查cast'
const P = (rel) => join(lib, pid, rel)
mkdirSync(P('人物'), { recursive: true })
mkdirSync(P('正文'), { recursive: true })

const F = (no, slice, cast) =>
  ['---', `章号: ${no}`, `题名: 第${no}章`, `切片: ${slice}`, `涉及人物: [${cast.join(', ')}]`, '---', '', `第${no}章正文。`].join('\n')

// ① 5 位人物档案（第 5 位 第五 存在但不在预算前 4 位内）
for (const [n, d] of [['林晚', '女主'], ['周守', '男二'], ['顾知远', '男三'], ['苏禾', '女二'], ['第五', '男四']]) {
  writeFileSync(P(`人物/${n}.md`), `# ${n}\n\n${d}档案内容。\n`, 'utf-8')
}
// ② 第 1 章（前情）与第 2 章（走查对象）
writeFileSync(P('正文/第01章_前情.md'), F(1, '第一幕_前情', ['林晚']), 'utf-8')
writeFileSync(P('正文/第02章_多人局.md'), F(2, '第二幕_多人局', ['林晚', '周守', '顾知远', '苏禾', '第五']), 'utf-8')

// ③ bundle 主进程 agent 引擎（electron → stub）
const out = join(tmp, 'bundle.mjs')
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
const events = []
console.log('=== 开始 runChat（第 2 章 / 涉及人物补充走查）：', new Date().toISOString())
const rid = 'cast-' + Date.now()
await mod.runChat(
  {
    requestId: rid,
    projectId: pid,
    chapterRel: '正文/第02章_多人局.md',
    chapterTitle: '第2章',
    prompt:
      '本章涉及人物共有哪几位？只回答名字清单，不要调用任何工具读文件。',
    quote: null
  },
  (e) => {
    events.push(e)
    if (e.type === 'delta') process.stdout.write(e.text)
    else if (e.type === 'meta') console.log('\n[工具]', e.tool)
    else if (e.type === 'meta-done') console.log('[工具完成]', e.message.slice(0, 60))
    else if (e.type === 'error') console.error('\n[错误]', e.message)
  }
)
console.log('\n=== 完成，事件数:', events.length)
await mod.shutdown()

const final = events.filter((e) => e.type === 'final').map((e) => e.text).join('\n')
console.log('\n[最终回复]\n' + final)
const tools = events.filter((e) => e.type === 'meta').map((e) => e.tool)
console.log('\n调用工具:', JSON.stringify(tools))

// ⑤ 断言：全部 5 位都被模型知道（第 5 位只能来自「涉及人物补充」块）
const cast = ['林晚', '周守', '顾知远', '苏禾', '第五']
const hit = cast.filter((n) => final.includes(n))
const pass = hit.length === 5
console.log('\n名单命中:', JSON.stringify(hit))
console.log(pass ? 'CAST SMOKE OK' : 'CAST SMOKE FAILED')
rmSync(tmp, { recursive: true, force: true })
process.exit(pass ? 0 : 1)
