// 织卷 · 真模型两轮冒烟——「工具读文档上下文」审计（主线②最后一环）
// 场景：素材文件（素材库/桥段/追忆型开头.md）的核心意象不在装配路标（2026-09-18 起路标=素材文件
//       动态生成，但预览只取首段中性引子；核心意象在该文件中段 → 模型仍须 zj_read_doc 现读）。
// 第一轮：prompt 让模型 zj_read_doc 读该素材并复述核心意象 → 验证工具结果确实进入模型侧上下文（此前无脚本验证过）。
// 第二轮：history 只带第一轮的 user/assistant（渲染层真实口径：filter 掉 tool 消息、slice(-20)）→
//         验证无状态会话（每轮新 sid）下：工具内容已不在上下文时，模型靠「历史总结」或「重新 zj_read_doc」续上，
//         不编造、不断链。若第二轮答不出且不重读 = 工具内容丢失真实伤协作（发现即修的触发点）。
// 用法：cd ~/Desktop/织卷 && node scripts/context-tools-live.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-ctxtools-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: join(tmp, 'lib') }), 'utf-8')

const lib = join(tmp, 'lib')
const pid = '工具上下文冒烟'
const P = (rel) => join(lib, pid, rel)
mkdirSync(P('正文'), { recursive: true })
mkdirSync(P('素材库/桥段'), { recursive: true })
mkdirSync(P('世界观'), { recursive: true })
mkdirSync(P('人物'), { recursive: true })

// 素材：核心意象在文件中段（装配路标只给首段中性引子，不会泄底——2026-09-18 动态路标后探针保真设计）
// 注意：若把「挂钟三点十七分/绿萝枯死」移到首段，装配路标的 48 字预览就会包含核心意象，
//       第一轮「工具读文档才答得出」的验证将失真（模型可凭装配作答）。
writeFileSync(
  P('素材库/桥段/追忆型开头.md'),
  ['# 桥段素材：追忆型开头', '', '老宅的门轴生了锈，吱呀一声。', '老式挂钟停在三点十七分，指针像是锈住了。', '窗台上那盆绿萝早已枯死，只剩焦黄的卷叶。', '他盯着墙上的全家福，突然记不起母亲的脸。'].join('\n'),
  'utf-8'
)
// 索引.md 是作者侧目录文档，不再是模型信号源（2026-09-18）；保留用于说明
writeFileSync(
  P('素材库/索引.md'),
  ['# 素材库索引', '', '- 桥段/追忆型开头.md —— 追忆型开头桥段'].join('\n'),
  'utf-8'
)
// 当前章：正文刻意不含素材意象（防模型从装配上下文作答）
writeFileSync(
  P('正文/第01章_开篇.md'),
  ['---', '章号: 1', '题名: 开篇', '切片: 第一幕', '涉及人物: []', '---', '', '他回到老宅，屋里很安静。', ''].join('\n'),
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
  const events = []
  const rec = (e) => {
    events.push(e)
    if (e.type === 'delta') process.stdout.write(e.text)
    else if (e.type === 'meta') console.log('\n[工具]', e.tool, e.args ?? '')
    else if (e.type === 'meta-done') console.log('[工具完成]', e.message.slice(0, 50))
    else if (e.type === 'error') console.error('\n[错误]', e.message)
  }
  return { events, rec }
}

const chRel = '正文/第01章_开篇.md'
const p1 = '请先用 zj_read_doc 读取 素材库/桥段/追忆型开头.md，然后用一句话告诉我：这个素材的核心意象是什么（点名最独特的具体物件）。'
console.log('=== 第一轮（让模型读六要素之外的素材）===', new Date().toISOString())
const r1 = collect()
await mod.runChat({ requestId: 'ct-1', projectId: pid, chapterRel: chRel, chapterTitle: '开篇', prompt: p1, quote: null }, r1.rec)
const final1 = r1.events.filter((e) => e.type === 'final').map((e) => e.text).join('\n')
console.log('\n[第一轮最终回复]\n' + final1)
const readOk = r1.events.some((e) => e.type === 'meta' && e.tool === 'zj_read_doc')
const keys1 = ['挂钟', '三点十七', '绿萝', '枯']
const hit1 = keys1.filter((k) => final1.includes(k))
console.log('第一轮：读了盘=' + readOk + ' 意象命中=' + JSON.stringify(hit1))

console.log('\n=== 第二轮（仅带第一轮 user/assistant 历史，无 session 记忆）===')
const r2 = collect()
await mod.runChat(
  {
    requestId: 'ct-2',
    projectId: pid,
    chapterRel: chRel,
    chapterTitle: '开篇',
    prompt: '你上一轮读过的那份素材，核心意象是什么？如果你已记不清具体内容，请用 zj_read_doc 重新读取 素材库/桥段/追忆型开头.md 再回答。',
    quote: null,
    history: [
      { role: 'user', content: p1 },
      { role: 'assistant', content: final1 }
    ]
  },
  r2.rec
)
const final2 = r2.events.filter((e) => e.type === 'final').map((e) => e.text).join('\n')
console.log('\n[第二轮最终回复]\n' + final2)
const read2 = r2.events.some((e) => e.type === 'meta' && e.tool === 'zj_read_doc')
const keys2 = ['挂钟', '三点十七', '锈住', '绿萝']
const hit2 = keys2.filter((k) => final2.includes(k))
console.log('第二轮：重读了=' + read2 + ' 意象命中=' + JSON.stringify(hit2))

await mod.shutdown()

const pass = readOk && hit1.length >= 1 && hit2.length >= 1
console.log('\n' + (pass ? 'CONTEXT-TOOLS LIVE OK' : 'CONTEXT-TOOLS LIVE FAILED'))
rmSync(tmp, { recursive: true, force: true })
process.exit(pass ? 0 : 1)
