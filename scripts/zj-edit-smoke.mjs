// zj_edit_doc 真机冒烟：走主进程 runChat + 真边车真模型，验证工具被调用且 translate 出 edit 事件。
// 用法：cd ~/Desktop/织卷 && LOCAL_LLM_KEY=local node scripts/zj-edit-smoke.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
const out = '/tmp/zj-edit-smoke.mjs'

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
const rid = 'editsmoke-' + Date.now()
let gotEdit = false
let gotMeta = false
console.log('=== 开始 runChat（zj_edit_doc 冒烟）', new Date().toISOString())
await mod.runChat(
  {
    requestId: rid,
    projectId: 'agent冒烟',
    chapterRel: '正文/第01章_雾港.md',
    chapterTitle: '雾港',
    prompt:
      '把当前这一章里“雾港的夜把整条街都浸在灰里。”改成“雾港的夜把整条街都浸在铅灰色的雾里。”，理由：这里写沉一点更好。请用 zj_edit_doc 工具直接给出修改方案。',
    quote: null
  },
  (e) => {
    if (e.type === 'delta') process.stdout.write(e.text)
    else if (e.type === 'meta') {
      gotMeta = true
      process.stdout.write('\n[工具] ' + e.tool + (e.args ? ' · ' + e.args : '') + '\n')
    } else if (e.type === 'meta-done') process.stdout.write('[工具完成] ' + e.message.slice(0, 60) + '\n')
    else if (e.type === 'edit') {
      gotEdit = true
      process.stdout.write('\n[正文修改提案] file=' + e.file + ' 处数=' + e.edits.length + '\n')
      for (const ed of e.edits || []) {
        process.stdout.write('  - find: ' + ed.find.slice(0, 50) + '\n    → ' + ed.replace.slice(0, 60) + (ed.reason ? '（' + ed.reason + '）' : '') + (ed.before ? '\n    before: ' + ed.before.slice(0, 80) : '') + '\n')
      }
    } else if (e.type === 'final') process.stdout.write('\n[最终回复] ' + e.text.slice(0, 200) + '\n')
    else if (e.type === 'error') process.stdout.write('\n[错误] ' + e.message + '\n')
  }
)
console.log('\n=== 结果: gotMeta=' + gotMeta + ' gotEdit=' + gotEdit)
process.exit(gotEdit ? 0 : 1)
