// 织卷 · 真模型探针——zj_read_doc 描述引导「offset 续读优先」是否改变模型读取策略
// 背景：2026-09-17 00:00 轮观察项①实记：模型倾向 maxChars=80000 一次读全而非 offset 续读；
// 2026-09-18 03:00 轮按 Anthropic《Writing effective tools for agents》（工具描述会引导
// 模型工具调用行为；「encourage agents to pursue more token-efficient strategies」）
// 修正 zj_read_doc/zj_search 描述（src/plugins/zj-core.ts）。
// 场景：与 zj-read-offset-live.mjs 同构（超长切片设定 >6000 字符、尾部独家事实不在装配内），
// 但提示词保持中立（不暗示「可调大 maxChars」），看模型是否按描述走 offset 续读。
// 判定：OFFSET=发生 offset>0 的续读调用 → 无大读且尾部可达即 OK（offset 或 zj_search 定向
// 都是 token 高效路径，目标=不再 maxChars 大读）；仅 maxChars>7000 大读到达 → WARN（描述
// 引导未生效，如实登记）；未到达尾部 → FAILED。
// 用法：node scripts/zj-tooldesc-live.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-tooldesc-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeProbeSettings({ libraryRoot: join(tmp, 'lib') })

const lib = join(tmp, 'lib')
const pid = 'tooldesc冒烟'
const P = (rel) => join(lib, pid, rel)
mkdirSync(P('正文'), { recursive: true })
mkdirSync(P('世界观'), { recursive: true })

const filler = '雾港的海风带着咸腥，码头缆桩上的麻绳被潮气浸透。'.repeat(320) // ~7680 字符
const tail =
  '\n\n【新增设定】雷暴之夜后，港务局在防波堤尽头埋了一只金色怀表——指针停在凌晨四点，作为「潮位异常」的记号，此后每晚南风起时码头工都会绕开那一段。'
writeFileSync(
  P('世界观/切片_第一幕.md'),
  ['---', '切片: 第一幕', '时间: 初秋', '---', '', '# 切片：第一幕', '', '## 环境状态', '雾港近期持续南风，灯塔检修。', filler, tail].join('\n'),
  'utf-8'
)
writeFileSync(
  P('正文/第01章_夜港.md'),
  ['---', '章号: 1', '题名: 夜港', '切片: 第一幕', '涉及人物: []', '---', '', '他在码头值夜，远处灯塔的灯一闪一闪。', ''].join('\n'),
  'utf-8'
)

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

const calls = []
const events = []
const rec = (e) => {
  events.push(e)
  if (e.type === 'delta') process.stdout.write(e.text)
  else if (e.type === 'meta') {
    calls.push({ tool: e.tool, args: e.args ?? '' })
    console.log('\n[工具]', e.tool, e.args ?? '')
  } else if (e.type === 'error') console.error('\n[错误]', e.message)
}

const p1 =
  '请用 zj_read_doc 读取 世界观/切片_第一幕.md，读完后回答：这个切片文件里有关「金色物品」的设定是什么？'
console.log('=== 中立提示词（不暗示可调大 maxChars）===', new Date().toISOString())
await mod.runChat(
  { requestId: 'td-1', projectId: pid, chapterRel: '正文/第01章_夜港.md', chapterTitle: '夜港', prompt: p1, quote: null },
  rec
)
const final1 = events.filter((e) => e.type === 'final').map((e) => e.text).join('\n')
console.log('\n[最终回复]\n' + final1)

await mod.shutdown()

const docCalls = calls.filter((c) => c.tool === 'zj_read_doc')
const hit = final1.includes('怀表') && final1.includes('凌晨四点')
const usedOffset = docCalls.some((c) => /"offset":\s*[1-9]\d*/.test(c.args) || /offset\D+[1-9]\d*/.test(c.args))
const usedBigMax = docCalls.some((c) => /"maxChars":\s*[7-9]\d{3,}/.test(c.args))
console.log('\nzj_read_doc 调用=' + JSON.stringify(docCalls.map((c) => c.args)))
console.log('尾部命中=' + hit + ' 使用offset续读=' + usedOffset + ' 大读maxChars>7000=' + usedBigMax)

let verdict = 'FAILED'
if (hit && usedBigMax) verdict = 'WARN（仍大读，描述引导未生效；行为未变，如实登记）'
else if (hit && !usedBigMax) verdict = 'OK（未大读且尾部可达——offset 续读或 zj_search 定向均属 token 高效路径）'
console.log('\nTOOLDESC LIVE ' + verdict)
rmSync(tmp, { recursive: true, force: true })
process.exit(verdict === 'OK' ? 0 : 1)
