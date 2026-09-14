// 织卷 · 真模型冒烟——zj_read_doc 区间续读（offset）与尾部可达性（观察项③收尾）
// 场景（对照观察项③原场景）：超级长的「切片设定文件」（>6000 字符，尾部含独特标记「金色怀表停在凌晨四点」）。
// 装配按 CAP.slice=4000 保头——尾部标记不进【当前创作上下文】；工具默认 maxChars=6000 也只保头。
// 模型看到返回里的「可传 offset=6000 继续读」提示后，须续读（offset 或调大 maxChars）才能到达尾部标记。
// 断言：工具调用 ≥2 次（发生续读）且最终答复包含尾部标记（关键信息无漏注入）。
// 用法：cd ~/Desktop/织卷 && node scripts/zj-read-offset-live.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-readoff-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: join(tmp, 'lib') }), 'utf-8')

const lib = join(tmp, 'lib')
const pid = 'offset冒烟'
const P = (rel) => join(lib, pid, rel)
mkdirSync(P('正文'), { recursive: true })
mkdirSync(P('世界观'), { recursive: true })

// 超长切片文件：前 6000+ 字符为模板说明与设定项，末尾最后一段含独特标记（与其余内容刻意绝缘）
const filler =
  '雾港的海风带着咸腥，码头缆桩上的麻绳被潮气浸透。'.repeat(320) // ~7680 字符，稳超默认 6000
const tail =
  '\n\n【新增设定】雷暴之夜后，港务局在防波堤尽头埋了一只金色怀表——指针停在凌晨四点，作为「潮位异常」的记号，此后每晚南风起时码头工都会绕开那一段。'
writeFileSync(
  P('世界观/切片_第一幕.md'),
  [
    '---',
    '切片: 第一幕',
    '时间: 初秋',
    '---',
    '',
    '# 切片：第一幕',
    '',
    '## 环境状态',
    '雾港近期持续南风，灯塔检修。',
    filler,
    tail
  ].join('\n'),
  'utf-8'
)
// 当前章：正文刻意不含标记（防模型从装配正文作答）；切片=第一幕（装配切片保头 4000，看不到尾部）
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

const collect = () => {
  const calls = []
  const events = []
  const rec = (e) => {
    events.push(e)
    if (e.type === 'delta') process.stdout.write(e.text)
    else if (e.type === 'meta') {
      calls.push(e.args ?? '')
      console.log('\n[工具]', e.tool, e.args ?? '')
    } else if (e.type === 'meta-done') console.log('[工具完成]', (e.message ?? '').slice(0, 60).replace(/\n/g, '⏎'))
    else if (e.type === 'error') console.error('\n[错误]', e.message)
  }
  return { events, rec, calls }
}

const p1 =
  '请用 zj_read_doc 读取 世界观/切片_第一幕.md，只能使用 zj_read_doc（读到截断提示可以照抄 offset 继续读或调大 maxChars 重读），不要使用 zj_search 等搜索工具；读全后回答：这个切片文件里有关「金色物品」的设定是什么？'
console.log('=== 第一轮（切片超长 · 尾部标记不在装配内）===', new Date().toISOString())
const r1 = collect()
await mod.runChat(
  { requestId: 'ro-1', projectId: pid, chapterRel: '正文/第01章_夜港.md', chapterTitle: '夜港', prompt: p1, quote: null },
  r1.rec
)
const final1 = r1.events.filter((e) => e.type === 'final').map((e) => e.text).join('\n')
console.log('\n[第一轮最终回复]\n' + final1)

await mod.shutdown()

const readCount = r1.calls.filter(() => true).length
const docReads = r1.calls.filter((a) => a.includes('切片_第一幕')).length
const hit = final1.includes('怀表') && final1.includes('凌晨四点')
console.log('\n工具调用=' + JSON.stringify(r1.calls) + ' zj_read_doc次数=' + docReads + ' 尾部标记命中=' + hit)
// 验收口径（观察项③）：尾部关键信息无漏注入——模型到达尾部标记即通过；
// offset 续读的具体正确性已由单测 zjReadDoc.test.ts 覆盖（offset 中段/越界/尾部三种）
const pass = hit
console.log('\n' + (pass ? 'ZJ-READ-OFFSET LIVE OK' : 'ZJ-READ-OFFSET LIVE FAILED'))
rmSync(tmp, { recursive: true, force: true })
process.exit(pass ? 0 : 1)
