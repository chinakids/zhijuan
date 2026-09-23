// 织卷 · 全卷巡查材料包（volumeBrief）读入口径真模型探针（2026-09-19 智能层）
// 背景：volumeBrief 旧版每章 clip(2400,1400)=3800 窗口（真实章 6851–10941/中位 8548 全部被裁中段，
// 覆盖仅 44%）；设定档 clip(1800,800)=2600（真实 27 份人物档 7 份被裁）。本轮对齐：
// 正文=chapterBodyBlock（≤WCTX_CAPS.chapter 全量/超保尾+注明现读，与 runChat/本章小环同源）；
// 设定档=clip(t, WCTX_CAPS.char, 800)（真实 27 份全量）。
// 场景：临时项目 9 章程序化正文（每章 ~8000 字符真实长章形态）+ 林晓档案 ~4600（身份在档中段）+ 陈默档。
//   X=第4章中段（旧 3800 窗口外、新口径全量内）「林晓曾任刑警」 vs 档案「高中美术老师」→ 旧版结构性漏检场景；
//   Y=第8章尾部「陈默退伍军人」 vs 档案「码头值夜人」→ 常规尾部命中对照；
//   Z=第9章（13000 字符超预算）开头「火车票」 vs 档案「没离开过小城」→ 超限保尾后被裁、验证 zj_read_doc 现读链（软观察）。
// 判定：数据层=新版 volumeBrief 含 X/Y/Z 对应材料且旧 clip 对照缺失；真模型=runAudit('consistency')
// 在 8min 内结构化输出且命中 X（硬）+ Y（硬）+ 耗时/工具轨迹（Z 转软观察）。
// 用法：cd ~/Desktop/织卷 && node scripts/volume-brief-live.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-volbrief-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: join(tmp, 'lib') }), 'utf-8')

const lib = join(tmp, 'lib')
const pid = '全卷巡查探针'
const P = (rel) => join(lib, pid, rel)
for (const d of ['人物', '世界观', '正文', '大纲']) mkdirSync(P(d), { recursive: true })

// ---- 场景文件 ----
const filler = (n) => Array.from({ length: n }, (_, i) => `夜色像一块湿布压在码头上。第${i + 1}巡的工人提着马灯走过栈桥，灯影在潮水里碎成一片。风从海面来，带着盐和远船的汽笛声。`).join('\n')

const X = '林晓把刑警队的旧证件从抽屉里翻出来，她在那儿值过十年夜班。' // 第4章中段（约4200处）
const Y = '陈默说自己是从边境退伍下来的，枪膛里的火气和茧子都在。' // 第8章尾部
const Z = '林晓的抽屉最深处压着一张泛黄的火车票。' // 第9章开头（保尾后被裁）

// 第1~8章：每章 ~8000 字符（filler 25 段每段 ~60 字 ≈ 1500？控制精确一点：用 repeat）
for (let n = 1; n <= 8; n++) {
  let body = ''
  if (n === 4) {
    // 前 4200 字符普通内容 + X + 后续内容（X 落在中段、旧 3800 窗口外）
    body = '第4章前段内容。'.repeat(700) + X + '第4章后续内容。'.repeat(650) // 4200 + 30 + 3900 ≈ 8130
  } else if (n === 8) {
    body = '第8章内容。'.repeat(1330) + Y + '第8章收尾。'.repeat(20) // 7980 + 26 + 100 ≈ 8106
  } else {
    body = `第${n}章内容。`.repeat(1350) // ≈8100
  }
  // 第8章需要 Y 位于尾部附近、第4章 X 位于中段——校验长度
  const fm = ['---', `章号: ${n}`, `题名: 夜航${n}`, '切片: 第一幕', '涉及人物: [林晓, 陈默]', '---'].join('\n') + '\n'
  writeFileSync(P(`正文/第${String(n).padStart(2, '0')}章_夜航${n}.md`), fm + body, 'utf-8')
}
// 第9章：超预算（约13000），Z 在开头
{
  const body9 = Z + '第9章内容。'.repeat(2160) // 20 + 12960 ≈ 12980 > 12000
  const fm9 = ['---', '章号: 9', `题名: 夜航9`, '切片: 第二幕', '涉及人物: [林晓]', '---'].join('\n') + '\n'
  writeFileSync(P('正文/第09章_夜航9.md'), fm9 + body9, 'utf-8')
}
// 人物档：林晓 ~4600（身份信息在档中段 ~2000 处；不超 4800 → 新口径全量）
{
  const mid = '身份：高中美术老师。'
  const doc = '# 林晓\n\n' + '档案内容。'.repeat(450) + '\n' + mid + '\n' + '档案后半内容。'.repeat(450)
  writeFileSync(P('人物/林晓.md'), doc, 'utf-8')
}
writeFileSync(P('人物/陈默.md'), '# 陈默\n\n码头值夜人，话不多。\n', 'utf-8')
writeFileSync(P('世界观/切片_第一幕.md'), '# 切片：第一幕\n\n- 雾港的钟楼指针永远慢七分钟\n', 'utf-8')

// ---- 数据层：bundle audit.ts，抽 volumeBrief 纯材料包 ----
const out = join(tmp, 'audit-bundle.mjs')
await esbuild({
  entryPoints: [resolve(root, 'src/main/agent/audit.ts')],
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
const brief = mod.volumeBrief(pid)
console.log('=== 数据层：volumeBrief(pid) ===')
console.log('材料包字符数:', brief.length)
const hasX = brief.includes(X)
const hasY = brief.includes(Y)
const hasZNote = brief.includes('已超 12000 字符预算') && brief.includes('第09章_夜航9.md')
const hasIdentity = brief.includes('高中美术老师')
// 旧口径对照（clip 2400/1400 + 1800/800 逻辑复刻）——证明旧版对 X 是盲区
const oldCh4 = (() => {
  const raw = readFileSync(P('正文/第04章_夜航4.md'), 'utf8')
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '')
  return body.length <= 2400 + 1400 ? body : body.slice(0, 2400) + body.slice(-1400)
})()
console.log('X(第4章中段) 在新版=', hasX, ' 旧窗口=', oldCh4.includes(X))
console.log('Y(第8章尾部) 在新版=', hasY)
console.log('Z 省略注记+现读路径=', hasZNote, ' 林晓身份(档中段)=', hasIdentity)
const dataPass = hasX && hasY && hasZNote && hasIdentity && !oldCh4.includes(X)
console.log(dataPass ? 'VOLBRIEF DATA OK' : 'VOLBRIEF DATA FAILED')

if (process.env.ZJ_DATA_ONLY === '1') {
  rmSync(tmp, { recursive: true, force: true })
  process.exit(dataPass ? 0 : 1)
}

// ---- 真模型：runAudit('consistency')（真边车+真 vLLM） ----
console.log('\n=== 开始 runAudit（全卷一致性巡查）：', new Date().toISOString())
const t0 = Date.now()
let res
try {
  res = await mod.runAudit(pid, 'consistency')
} catch (e) {
  console.error('runAudit 抛错:', String(e))
  res = null
}
const secs = ((Date.now() - t0) / 1000).toFixed(1)
if (!res || !res.ok) {
  console.log('runAudit FAILED:', res?.error ?? 'null', '耗时', secs + 's')
  process.exit(1)
}
console.log('=== runAudit 完成，耗时', secs + 's ===')
const items = res.result.items ?? []
console.log('items=', items.length)
for (const it of items) console.log(`- [${it.severity}] ${it.type} @ ${it.where} :: ${it.what}`)
const all = JSON.stringify(items) + JSON.stringify(res.result.summary ?? '')
const hitX = /刑警|第\s*[04]\s*章|第0?4章|第四章/.test(all) && all.includes('林晓')
const hitY = /退伍|军人|边境|第\s*[08]\s*章|第0?8章|第八章/.test(all)
console.log('命中 X(中段刑警冲突)=', hitX, ' 命中 Y(尾部退伍冲突)=', hitY)
const livePass = hitX && hitY
console.log('\n' + (dataPass && livePass ? 'VOLBRIEF LIVE OK' : 'VOLBRIEF LIVE FAILED'))
console.log(`[耗时 ${secs}s；8min=480s]`)
rmSync(tmp, { recursive: true, force: true })
process.exit(dataPass && livePass ? 0 : 1)
