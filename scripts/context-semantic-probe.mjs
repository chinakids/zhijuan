// 上下文域 · 语义召回必要性评估探针（评估资产，2026-09-17 智能层 21:00 轮）
// 用途：验证「素材/文档语义检索（embedding）」相对关键词搜索（searchDocs 口径）的边际收益。
//   合成 20 篇「意象标题」素材（标题不含主题词、正文含主题场景——模拟素材库「标题≠主题」形态）
//   + 10 个查询（词面 2 / 同义 8），基线=复刻织卷 searchDocs（文件名+全文 includes、空格分词 AND）。
// 用法：node scripts/context-semantic-probe.mjs [model]
//   model 默认 nomic-embed-text（本机 ollama 已有）；中文评估建议 bge-m3（ollama pull bge-m3 后）。
// 判定：KW_HIT=N/10（关键词命中数，全漏=同义漏检场景成立）；SEMI_TOP5_HIT=N/10（语义 Top-5 召回）。
// 背景：本轮实证 nomic=5/10（中文弱、分数密集 0.62–0.69、top 高频无关「梅雨季」）；bge-m3（567M/8K/100+语言）
//   为中文推荐模型，尚未本机实测（2026-09-17 下载未完成，见智能层档案 21:00 轮观察项）。
const fs = await import('node:fs');
const model = process.argv[2] || 'nomic-embed-text';

// [标题, 类别, 主题词(应命中), 正文]
const MATS = [
  ['巷口那盏灯', '环境', '路灯', '巷口的路灯整夜亮着，昏黄的光罩住半条石板路。晚自习回来的学生常常借着这盏灯背书，守夜的老班长隔两个小时来换一次灯泡。'],
  ['雨停了之后', '环境', '雨夜', '雨在凌晨三点停了，屋檐还在滴水。楼下传来卖早点的动静，空气里是潮湿的青苔味。'],
  ['绿皮火车', '桥段', '离别', '站台上人很多，他隔着车窗挥手，车开的时候她才想起忘了说再见。绿皮火车慢慢把小城甩在身后。'],
  ['旧照片', '桥段', '重逢', '十年后他在旧相册里看到她，照片已经泛黄。同学聚会上她坐在对面，笑起来的模样一点没变。'],
  ['玻璃弹珠', '桥段', '童年', '铁皮盒子里的玻璃弹珠是他整个童年的家当。跳房子、拍画片、放学路上的梧桐树，都回不去了。'],
  ['准考证', '桥段', '考试', '准考证上的照片还是证件照，他盯着看了很久。考场外家长的叮嘱声，和那年夏天的蝉鸣混在一起。'],
  ['便利贴上', '桥段', '暗恋', '她每次把便利贴递过来都故意放慢动作，他想说的话到了嘴边又咽回去，只敢在草稿纸上反复写她的名字。'],
  ['祖父的怀表', '环境', '旧物', '怀表停在凌晨四点，那是祖父走的时间。表壳内侧刻着一行小字，他一整个下午都在辨认那行字。'],
  ['便利店灯光', '环境', '深夜', '凌晨一点，便利店的灯还是亮的。他买了关东煮坐在窗边，看这座城市慢慢睡去。'],
  ['第一场雪', '环境', '雪', '初雪落下来的那个晚上，整个城市都安静了。她伸手接了一片，很快就化在手心里。'],
  ['家宴', '桥段', '饭局', '年夜饭的桌上摆满了菜，大家聊着各自的近况。母亲一直往他碗里夹菜，好像他还是个孩子。'],
  ['河边的路灯', '环境', '路灯', '护城河边的路灯排成一线，散步的人来来往往。他每天从这里经过，习惯了灯影里的城市。'],
  ['梅雨季', '环境', '雨夜', '梅雨季的雨没完没了。他撑伞走过天桥，桥下的车灯连成河流，像另一个世界。'],
  ['车站的钟', '桥段', '离别', '车站大钟的指针一分一秒地走，他拖着行李箱在候车厅来回踱步。广播里报站的声音一遍遍响起。'],
  ['毕业纪念册', '桥段', '童年', '毕业纪念册上写满了幼稚的祝福语。他翻到最后一页，班主任写的那句话让他鼻子一酸。'],
  ['最后一节课', '桥段', '考试', '高考前最后一堂课，老师没有讲题，只是把三年的话讲完了。下课铃响的时候，全班都安静了。'],
  ['抽屉里的信', '桥段', '暗恋', '抽屉最里面压着一封没有寄出去的信，写了又改，改了又写。后来他搬家，那封信不知道丢在了哪里。'],
  ['老屋', '环境', '旧物', '老屋要拆了。他回去收拾东西，墙上还有小时候量身高的铅笔印，柜子里是母亲爱用的缝纫机。'],
  ['凌晨的灯', '环境', '深夜', '凌晨三点的写字楼还有一层亮着灯。他泡了杯咖啡，继续改那份改了八遍的方案。'],
  ['雪夜归人', '环境', '雪', '雪越下越大，他深一脚浅一脚地走在回家的路上。路灯把雪花照成金色的，世界安静得能听见呼吸。']
];
// 查询: [q, 应命中标题数组, 说明] —— 前 1 组词面（标题/正文含查询词），其余同义（均不含）
const QUERIES = [
  ['路灯', ['巷口那盏灯', '河边的路灯'], '词面'],
  ['雨夜', ['雨停了之后', '梅雨季'], '词面'],
  ['说再见', ['绿皮火车', '车站的钟'], '同义'],
  ['故人久别', ['旧照片'], '同义'],
  ['小时候', ['玻璃弹珠', '毕业纪念册'], '同义'],
  ['高考', ['准考证', '最后一节课'], '同义'],
  ['喜欢一个人', ['便利贴上', '抽屉里的信'], '同义'],
  ['遗物', ['祖父的怀表', '老屋'], '同义'],
  ['凌晨加班', ['凌晨的灯', '便利店灯光'], '同义'],
  ['初雪', ['第一场雪', '雪夜归人'], '同义']
];

async function embedLocal(texts) {
  const r = await fetch('http://localhost:11434/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(120000)
  });
  if (!r.ok) throw new Error('embed HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return j.embeddings;
}
function cos(a, b) {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return s / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
// 基线: searchDocs 复刻（文件名+正文 includes、空格分词 AND）
function kwHit(q, m) {
  const terms = q.split(/\s+/).filter(Boolean);
  const lower = (m[0] + '\n' + m[3]).toLowerCase();
  return terms.every((t) => lower.includes(t));
}

const texts = MATS.map((m) => m[0] + ' ' + m[3]);
let vecs;
try {
  vecs = await embedLocal(texts);
} catch (e) {
  console.log('EMBED ERR', e.message);
  process.exit(2);
}
console.log('EMBED MODEL=', model, 'vecs=', vecs.length, 'dim=', vecs[0].length);

let kwHitAll = 0, semiHitAll = 0;
const rows = [];
for (const [q, targets, kind] of QUERIES) {
  const kw = MATS.filter((m) => kwHit(q, m)).map((m) => m[0]);
  const qv = (await embedLocal([q]))[0];
  const scored = MATS.map((m, i) => ({ name: m[0], s: cos(qv, vecs[i]) }))
    .sort((a, b) => b.s - a.s).slice(0, 5);
  const semi = scored.map((x) => x.name);
  const kwOk = targets.some((t) => kw.includes(t));
  const semiOk = targets.some((t) => semi.includes(t));
  if (kwOk) kwHitAll++; if (semiOk) semiHitAll++;
  rows.push({ q, target: targets.join('|'), kind, kw, semi, kwOk, semiOk, top: scored.slice(0, 3).map((x) => x.name + '@' + x.s.toFixed(3)).join(' | ') });
}
console.log('KW_HIT=' + kwHitAll + '/' + QUERIES.length + '  SEMI_TOP5_HIT=' + semiHitAll + '/' + QUERIES.length);
for (const r of rows) {
  console.log(`Q[${r.q}]→[${r.target}] ${r.kind}  KW:${r.kwOk ? 'HIT' : 'MISS'}(${r.kw.join(',') || '-'})  SEMI:${r.semiOk ? 'HIT' : 'MISS'} top=${r.top}`);
}
