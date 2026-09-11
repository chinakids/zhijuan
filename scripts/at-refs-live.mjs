// @ 引用注入上下文 · 真模型冒烟：带 〔类型·名称｜路径〕 引用标记的 runChat 走真边车+真模型，
// 验证注入不破坏链路（正常流式、正常工具、正常收尾），且引用的内容确实进了模型视野（问档案独有细节）。
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local node scripts/at-refs-live.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
// 同 at-refs-smoke：干净 userData，避免 /tmp/zj-smoke-userdata 残留设置把库路径指歪
process.env.ZJ_USERDATA = '/tmp/zj-smoke-atrefs-live'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
const out = '/tmp/at-refs-live-bundle.mjs'

await esbuild({
  stdin: {
    contents: `export { runChat } from ${JSON.stringify(resolve(root, 'src/main/agent/engine.ts'))};`,
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

const { runChat } = await import(pathToFileURL(out).href)

const rid = 'atrefs-' + Date.now()
let gotDelta = false
let gotFinal = false
let gotMeta = false
let error = null
let finalText = ''

console.log('=== 开始 runChat（@ 引用注入 真机冒烟）', new Date().toISOString())
await runChat(
  {
    requestId: rid,
    projectId: 'agent冒烟',
    chapterRel: '正文/第01章_雾港.md',
    chapterTitle: '雾港',
    prompt:
      '〔人物·林晓｜人物/林晓.md〕〔章节·雾港｜正文/第01章_雾港.md〕 只回答两个问题（不要用工具）：1）上面引用的林晓档案里，她是什么身份？2）引用正文里，她在栈桥上等什么？一两个短句即可。',
    quote: null
  },
  (e) => {
    if (e.type === 'delta') {
      gotDelta = true
      process.stdout.write(e.text)
    } else if (e.type === 'meta') {
      gotMeta = true
      process.stdout.write('\n[工具] ' + e.tool + (e.args ? ' · ' + e.args : '') + '\n')
    } else if (e.type === 'final') {
      gotFinal = true
      finalText = e.text
    } else if (e.type === 'error') {
      error = e.message
    }
  }
)
console.log('\n=== 结果: gotDelta=' + gotDelta + ' gotMeta=' + gotMeta + ' gotFinal=' + gotFinal + ' err=' + (error ?? '无'))
if (error) {
  console.error('运行错误：' + error)
  process.exit(1)
}
if (!gotDelta || !gotFinal) {
  console.error('流式/done 未到齐')
  process.exit(1)
}
// 注入内容来自档案+正文，模型正确复述=「引用内容进了上下文」的强信号（模型被要求不用工具）
const ok =
  (finalText.includes('渔家女') || finalText.includes('灯嫂')) &&
  finalText.includes('船')
console.log('关键信息核对：' + (ok ? 'PASS（渔家女/灯嫂 + 等船）' : 'FAIL，final=' + finalText.slice(0, 200)))
if (!ok) process.exit(1)

// —— 严格用例：引用 世界观/总纲.md（本章有切片设定→默认上下文不带总纲）——
// 「出海点灯」规则只存在于总纲；模型答出=只能来自 @ 注入块，排除默认上下文兜底。
console.log('\n=== 严格用例：引用总纲（默认上下文不含）===')
let strict = ''
await runChat(
  {
    requestId: rid + '-s',
    projectId: 'agent冒烟',
    chapterRel: '正文/第01章_雾港.md',
    chapterTitle: '雾港',
    prompt: '〔世界观·总纲｜世界观/总纲.md〕 只看上面引用的内容回答（不要用工具）：镇上的人出海前，按规矩要做什么？',
    quote: null
  },
  (e) => {
    if (e.type === 'delta') process.stdout.write(e.text)
    else if (e.type === 'final') strict = e.text
    else if (e.type === 'error') console.log('\n[错误] ' + e.message)
  }
)
console.log('\n严格用例回复：' + strict.slice(0, 200))
const okStrict = strict.includes('灯') && !strict.includes('不知道')
console.log('严格核对：' + (okStrict ? 'PASS（出海点灯——仅总纲所有）' : 'FAIL'))
process.exit(ok && okStrict ? 0 : 1)
