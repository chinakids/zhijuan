// 审读存档·空结果保护数据层冒烟（2026-09-20 智能层）：
// 提取失败（模型未按格式回复）时 runAudit 必须返回 ok:false 且【不覆盖】磁盘已有报告；
// 模型按格式回答「没有问题」（合法空 JSON=真零发现）时照常落盘「这一遍没有发现问题」。
// 走真代码路径（真 store/真 audit.ts/真 subtask.ts），仅 stub 掉模型会话 driveSession
// （bodylen-smoke 同模式）；临时项目跑完即删，真库零污染。
import { build as esbuild } from 'esbuild'
import { rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-userdata-auditempty'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })

// 按全局队列返回预设回复（bodylen-smoke 单回应变体：提取失败/零发现/正常多场景需按次控制）
const stub = '/tmp/runtime-stub-auditempty.mjs'
writeFileSync(
  stub,
  `export async function driveSession() { globalThis.__zjDriveCalls = (globalThis.__zjDriveCalls ?? 0) + 1; const q = globalThis.__zjReplyQueue ?? []; return q.length ? q.shift() : '[]' }\nexport function cancelTurn() {}\nexport function newSid(k) { return k + '-' + Date.now() }\nexport function closeHarness() { return Promise.resolve() }\n`
)

const out = '/tmp/zj-auditempty-smoke.mjs'
await esbuild({
  entryPoints: [resolve(root, 'src/main/agent/audit.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  plugins: [
    {
      name: 'stub-runtime',
      setup(b) {
        b.onResolve({ filter: /^\.\/runtime$/ }, (args) => ({ path: stub }))
      }
    }
  ],
  logLevel: 'warning'
})

const lib = '/Users/USER/Documents/织卷项目库'
const pid = 'zj-auditempty'
const d = lib + '/' + pid
rmSync(d, { recursive: true, force: true })
mkdirSync(d + '/正文', { recursive: true })
mkdirSync(d + '/人物', { recursive: true })
mkdirSync(d + '/世界观', { recursive: true })
mkdirSync(d + '/大纲', { recursive: true })
writeFileSync(d + '/正文/第01章_雾港.md', '---\n章号: 1\n题名: 雾港\n切片: 第一幕\n涉及人物: [韩青]\n---\n正文内容。', 'utf-8')
// 预置一份「上次好报告」：必须保持不被覆盖
const prevReport = '# 审读报告 · 一致性巡查\n\n> 织卷写作引擎 · 2026-09-19 06:00 · 每次重跑覆盖本文件…\n\n## 一句话结论\n\n（无总结）\n\n## 条目（1）\n\n### 1 · [高] 设定冲突\n\n- 位置：第01章\n- 现象：韩青机场值夜与档案冲突\n- 建议：改回\n'
writeFileSync(d + '/大纲/审读_一致性巡查.md', prevReport, 'utf-8')

const mod = await import(pathToFileURL(out).href)
const setQ = (q) => { globalThis.__zjReplyQueue = q }

let fail = 0
const check = (name, cond) => {
  if (!cond) { console.error('FAIL:', name); fail++ } else console.log('ok:', name)
}

// 场景 A：提取失败（两次截断）→ ok:false + 磁盘报告保持原样（好存档不丢）
setQ(['{"summary":"开头","items":[{"severity":"high"', '{"summary":"还是截断","items":[{"severity":'])
const rA = await mod.runAudit(pid, 'consistency')
check('A: ok=false', rA.ok === false)
if (!rA.ok) check('A: 错误含保护语义', /未覆盖/.test(rA.error))
check('A: 磁盘报告未变', readFileSync(d + '/大纲/审读_一致性巡查.md', 'utf-8') === prevReport)

// 场景 B：真零发现（合法空 JSON）→ ok:true + 落盘「这一遍没有发现问题」
setQ(['{"summary":"","items":[]}'])
const rB = await mod.runAudit(pid, 'consistency')
check('B: ok=true', rB.ok === true)
if (rB.ok) check('B: savedReport 回传', rB.savedReport === '大纲/审读_一致性巡查.md')
const bMd = readFileSync(d + '/大纲/审读_一致性巡查.md', 'utf-8')
check('B: 落盘零发现报告', /这一遍没有发现问题/.test(bMd) && /## 条目（0）/.test(bMd))

// 场景 C：正常报告 → ok:true + 落盘新条目（回归）
setQ(['{"summary":"要改灯塔","items":[{"severity":"high","type":"setting","where":"第01章","what":"灯塔写亮","suggest":"改回"}]}'])
const rC = await mod.runAudit(pid, 'consistency')
check('C: ok=true', rC.ok === true)
if (rC.ok) check('C: 条目解析', rC.result.items.length === 1)
check('C: 落盘新报告', /要改灯塔/.test(readFileSync(d + '/大纲/审读_一致性巡查.md', 'utf-8')))

// 场景 D：多视角同口径——截断不覆盖 + 合法空可落
setQ(['{"viewer":', '{"viewer":'])
const rD1 = await mod.runAudit(pid, 'perspectives')
check('D: perspectives 截断 ok=false', rD1.ok === false)
const prevP = readFileSync(d + '/大纲/审读_一致性巡查.md', 'utf-8')
setQ(['{"summary":"","items":[]}'])
const rD2 = await mod.runAudit(pid, 'perspectives')
check('D: perspectives 真零发现 ok=true', rD2.ok === true)
const dMd = readFileSync(d + '/大纲/审读_多视角审视.md', 'utf-8')
check('D: 多视角零发现落盘', /这一遍没有发现问题/.test(dMd))

rmSync(d, { recursive: true, force: true })
if (fail) { console.error('FAILED', fail); process.exit(1) }
console.log('PASS audit-empty-archive-smoke')
process.exit(0)
