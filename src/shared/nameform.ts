// ===== 织卷 · 称谓发现核查（本地规则层，零模型，2026-09-14） =====
// 调研结论（The Editor's Blog 2015-03-07「Using Names in Fiction—4 Tips」，Beth Hill）：
// #2 Multiple Names for One Character——同一个人物的多个名称必须克制、有计划地使用并前后一致；
// 昵称只出现一两次就不值得（"If you find you've called a character some cute nickname but only
// once or twice, change the reference"）；读者拿着笔记数名字而不是看故事，就是出戏的开始。
// 中文语境同理：称谓（韩师傅/老韩/沈叔）是人物关系与社会身份的标签，正文里被自然使用但档案未登记时，
// 机械层三块（presence/unused/conflict）都「看不见」它——unlisted 不命、agent 引用不识别。
// 本块补上缺口：从人物档案提取姓（复姓优先），枚举常见称谓模式（姓+职业/亲属后缀、老/小/阿/大+姓），
// 扫全卷正文（剥约定头与 HTML 注释），报「正文用了但档案未登记的疑似称谓」。
// 与 presence/order/unused/actgaps/sliceord 同构：纯函数、不读盘、输出 AuditResult；零模型、秒级、可高频重跑。
// 机械层承认局限：只识别「姓+常见后缀 / 老小阿大+姓」两类模式；单字名/代号/网名（无姓可识别）不参与；
// 三字人名恰好为「姓+单字后缀+名」时可能误报（如「韩叔同」→「韩叔」），low 级提示、方向安全，作者一扫即知。
import { extractFrontMatter } from './fmatter'
import { conflictedAliases, type PresenceChapter } from './presence'
import { aliasEditFor } from './aliasEdit'
import type { AuditItem, AuditResult, ProposalItem } from './types'

/** 称谓类条目 → 可执行「别名登记」提案（kind=replace-text，before/after=约定头精确改法）；
 *  人物档原文缺失或定位不到数组风格「别名:」/「姓名:」行时返回 undefined（调用方回退旧「建议追加」行为）。 */
function aliasProposal(
  rawChars: Record<string, string> | undefined,
  name: string,
  candidates: string[]
): ProposalItem | undefined {
  if (!rawChars || !candidates.length) return undefined
  const raw = rawChars[name]
  if (!raw) return undefined
  const edit = aliasEditFor(raw, candidates)
  if (!edit) return undefined
  return {
    target: `人物/${name}.md`,
    anchor: '',
    kind: 'replace-text',
    before: edit.before,
    after: edit.after,
    reason: '巡查建议 · 登记称谓别名'
  }
}

/** 常见复姓（优先于单姓匹配） */
const COMPOUND_SURNAMES = [
  '欧阳', '司马', '诸葛', '上官', '东方', '皇甫', '尉迟', '公孙', '慕容', '宇文', '令狐',
  '长孙', '司徒', '司空', '南宫', '西门', '夏侯', '澹台', '端木', '独孤', '轩辕', '百里',
  '呼延', '东郭', '太史', '钟离', '闻人', '拓跋', '淳于', '单于', '太叔', '申屠', '公羊',
  '公西', '颛孙', '巫马', '漆雕', '乐正', '壤驷', '公良', '段干', '梁丘', '左丘'
]

/** 常见单姓（含《百家姓》高频段与现代常见姓；仅用于「首字是否可作姓」判定，非穷举） */
const SINGLE_SURNAMES =
  '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴郁胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍却璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公'

/** 称谓后缀（职业/身份/亲属/泛称；匹配时按「更长的词优先」取，最大 3 字） */
const SUFFIXES = [
  '董事长', '老板娘', '工程师', '老师', '先生', '女士', '医生', '大夫', '护士', '律师',
  '教授', '警官', '警察', '队长', '主任', '经理', '老板', '局长', '校长', '院长', '厂长',
  '会计', '司机', '保姆', '保安', '厨师', '管家', '门卫', '掌柜', '伙计', '店主', '店长',
  '船长', '机长', '书记', '部长', '处长', '科长', '乡长', '镇长', '村长', '站长', '所长',
  '专员', '顾问', '教练', '裁判', '导师', '演员', '导演', '编剧', '记者', '编辑', '作家',
  '画家', '歌手', '诗人', '将军', '司令', '参谋', '秘书', '助理', '主管', '总监', '会长',
  '主席', '市长', '省长', '县长', '委员', '委员长', '理事长', '秘书长', '班主任', '教导主任',
  '师傅', '师父', '师叔', '师伯', '师兄', '师姐', '师弟', '师妹', '徒弟', '徒儿', '弟子', '老师傅',
  '学生', '学徒', '同学', '同窗', '战友', '同事', '同志', '战友', '新娘', '新郎', '娘子',
  '相公', '夫人', '太太', '小姐', '少爷', '公子', '千金', '大人', '老爷', '官人', '掌柜的',
  '王爷', '娘娘', '公主', '太子', '丞相', '尚书', '巡抚', '总督', '大人', '天使', '长老',
  '掌门', '宗主', '教主', '护法', '舵主', '堂主', '庄主', '盟主', '帮主', '寨主', '楼主',
  '婆婆', '爷爷', '奶奶', '公公', '大娘', '大爷', '大妈', '大叔', '大婶', '大伯', '阿姨',
  '阿婆', '阿公', '老爹', '老妈', '老爸', '兄弟', '哥们', '姐妹', '嫂子', '姐夫', '妹夫',
  '舅妈', '姑妈', '姨妈', '伯母', '婶婶', '婶娘', '姑父', '舅父', '姨夫', '姑姑', '姨娘',
  '姥姥', '姥爷', '外公', '外婆', '叔叔', '伯伯', '舅舅', '姑姑', '婶婶', '姨姨',
  '叔公', '伯公', '叔婆', '伯婆', '堂哥', '堂姐', '堂弟', '堂妹', '表哥', '表姐', '表弟', '表妹',
  '师父', '师娘', '师母', '教头', '总管', '掌柜', '把总', '千总', '提督', '统领', '校尉',
  '都头', '捕头', '镖头', '龙头', '掌门人', '班主', '团长', '旅长', '师长', '军长', '司令官',
  '老人家', '大爷', '老爷', '老板', '老总', '老兄', '老弟', '老姐', '老妹',
  '专家', '学者', '博士', '硕士', '学士', '考生', '书童', '丫鬟', '侍女', '仆人', '管家',
  '掌柜', '管家', '司机', '船长', '水手', '船员', '工人', '农民', '军医', '兽医', '画师',
  '琴师', '棋手', '书法家', '雕塑家', '音乐家', '舞蹈家', '运动员', '飞行员', '宇航员',
  '销售', '客服', '前台', '保安', '保洁', '园丁', '花匠', '木匠', '铁匠', '石匠', '瓦匠',
  '裁缝', '绣娘', '厨子', '伙夫', '马夫', '车夫', '轿夫', '挑夫', '渔夫', '船夫', '农夫',
  '货郎', '小贩', '商贩', '店主', '摊主', '庄主', '地主', '财主', '员外', '老爷', '师爷',
  '幕僚', '门客', '食客', '游客', '客人', '顾客', '旅客', '乘客', '看客', '听众', '观众',
  '读者', '作者', '编者', '译者', '评者', '说书人', '讲书人', '弹词人', '评话人',
  '七爷', '八爷', '九爷', '姑奶奶', '舅老爷', '姨太太', '二爷', '三爷', '四爷', '五爷', '六爷',
  '老', '小', '叔', '伯', '姨', '舅', '姑', '爷', '哥', '姐', '弟', '妹', '婆', '公',
  '婶', '夫', '郎', '倌', '僮', '童', '侍', '仆', '婢', '姬', '妾', '倌人', '鸨母', '老鸨'
]
const SUFFIX_SET = new Set(SUFFIXES)

/** 称谓前缀（老/小/阿/大 + 姓） */
const PREFIXES = ['老', '小', '阿', '大']

/** 从名字提取姓：复姓优先，其次常见单姓首字；无 → null（单字名/代号/网名等跳过） */
export function surnameOf(name: string): string | null {
  if (!name) return null
  for (const c of COMPOUND_SURNAMES) if (name.startsWith(c)) return c
  const first = name.charAt(0)
  return SINGLE_SURNAMES.includes(first) ? first : null
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 剥 HTML 注释（分幕缺段占位等），防把注释里的「韩师傅」当正文称谓 */
function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '')
}

function titleOf(fm: Record<string, unknown> | null, file: string): string {
  if (fm && typeof fm['题名'] === 'string' && fm['题名']) return String(fm['题名'])
  return (file.split('/').pop() ?? file).replace(/\.md$/i, '')
}

/** 命中处上下文：变体前后共 ~48 字，换行折叠为空格 */
function clipCtx(text: string, from: number, len: number, pad = 24): string {
  const a = Math.max(0, from - pad)
  const b = Math.min(text.length, from + len + pad)
  return text.slice(a, b).replace(/\s+/g, ' ').trim()
}

interface PersonInfo {
  name: string
  surname: string
}

/**
 * 称谓发现核查：输入全部章节（约定头 + 正文）、人物档案题名（knownChars）与登记别名表（aliasMap），
 * 输出 AuditResult（与审计抽屉同构）。口径：
 * - 只查「已建档且能从名字提取姓」的人物；变体 = 姓+常见后缀 / 老·小·阿·大+姓；
 * - 已登记为该人物别名、别名冲突（多主）、等于任一人物本名/别名、长度 <2 的变体不参与；
 * - 同一变体被两个及以上人物共享（如同姓双雄都未登记「韩师傅」）→ 归属不明，不报；
 * - 每（人物 × 变体）只报第一条命中；命中给出「首次出现于」的上下文片段。
 */
export function nameFormCheck(opts: {
  knownChars: string[]
  aliasMap?: Record<string, string[]>
  chapters: PresenceChapter[]
  /** 人物档原文（按人物名）——提供时称谓类条目构造「可执行别名登记提案」 */
  rawChars?: Record<string, string>
}): AuditResult {
  const aliasMap = opts.aliasMap ?? {}
  const persons: PersonInfo[] = []
  for (const n of opts.knownChars) {
    if (n.length < 2) continue
    const sur = surnameOf(n)
    if (sur) persons.push({ name: n, surname: sur })
  }
  if (!persons.length) {
    return {
      summary:
        '称谓发现核查（本地规则·零模型）：项目里没有可从名字识别出姓的人物档案（单字名/代号/无常见姓不参与），没有可核查对象。',
      items: []
    }
  }

  // 全局变体 → 唯一归属人物（过滤：等于本名/登记别名/冲突别名/任一人物本名/任一人物别名/归属重叠）
  const conflicted = conflictedAliases(aliasMap)
  const otherNames = new Set(opts.knownChars)
  const allAliases = new Set<string>()
  for (const al of Object.values(aliasMap)) for (const a of al) allAliases.add(a)
  const variantOwner = new Map<string, PersonInfo>()
  const dropped = new Set<string>()
  for (const p of persons) {
    const variants = new Set<string>()
    for (const suf of SUFFIXES) variants.add(p.surname + suf)
    for (const pre of PREFIXES) variants.add(pre + p.surname)
    for (const v of variants) {
      if (v.length < 2 || v === p.name) continue
      if ((aliasMap[p.name] ?? []).includes(v)) continue
      if (conflicted.has(v) || allAliases.has(v) || otherNames.has(v)) continue
      if (dropped.has(v)) continue
      if (variantOwner.has(v)) {
        // 归属重叠：同一变体被多个未登记人物共享 → 弃用（避免指认错误）
        variantOwner.delete(v)
        dropped.add(v)
        continue
      }
      variantOwner.set(v, p)
    }
  }
  if (!variantOwner.size) {
    return {
      summary: `称谓发现核查（本地规则·零模型）：扫描 ${persons.length} 个人物档案 × 常见称谓模式，未见可用的未登记称谓（已登记/与他人重名/单字模式均已排除）。`,
      items: []
    }
  }

  const surnames = [...new Set(persons.map((p) => p.surname))].sort((a, b) => b.length - a.length)
  const surnameRe = new RegExp('(' + PREFIXES.join('|') + ')?(' + surnames.map(escRe).join('|') + ')', 'g')
  const found = new Map<string, AuditItem>()
  const itemsDesc: string[] = []

  for (const ch of opts.chapters) {
    const { fm, body } = extractFrontMatter(ch.raw)
    const text = stripHtmlComments(body)
    if (!text) continue
    surnameRe.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = surnameRe.exec(text))) {
      const pre = m[1] ?? ''
      const sur = m[2]
      let v: string | null = null
      if (pre) {
        v = pre + sur
      } else {
        const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 4)
        for (let t = Math.min(rest.length, 4); t >= 1; t--) {
          if (SUFFIX_SET.has(rest.slice(0, t))) {
            v = sur + rest.slice(0, t)
            break
          }
        }
      }
      if (!v) continue
      const owner = variantOwner.get(v)
      if (!owner) continue
      const key = owner.name + '\u0000' + v
      if (found.has(key)) continue
      const ctx = clipCtx(text, m.index, m[0].length)
      found.set(key, {
        severity: 'low',
        type: 'character',
        where: `${titleOf(fm, ch.file)}（${ch.file}）`,
        what: `正文出现了「${v}」——「${owner.name}」档案未登记这一称谓（按创作规范，同一人物的称呼应克制且前后一致）。首次出现处：「…${ctx}…」。`,
        suggest: `若「${v}」确实指「${owner.name}」：在 人物/${owner.name}.md 约定头「别名: [...]」登记它，称谓核查与 agent 引用即可识别；若指未建档的另一人：忽略此条即可，或为 TA 建档。`,
        target: `人物/${owner.name}.md`,
        aliasCandidates: [v],
        proposal: aliasProposal(opts.rawChars, owner.name, [v])
      })
      itemsDesc.push(v)
    }
  }

  const items = [...found.values()]
  const scope =
    '口径：「姓+常见称谓后缀 / 老·小·阿·大+姓」两类模式；单字名、代号、无常见姓的人物不参与；已在档案登记或与他人重名者不计。'
  const summary = items.length
    ? `称谓发现核查（本地规则·零模型）：扫描 ${persons.length} 个人物档案 × 常见称谓模式，全卷正文发现 ${items.length} 个「正文在使用、档案未登记」的疑似称谓（${itemsDesc.slice(0, 4).join('、')}${itemsDesc.length > 4 ? ' 等' : ''}）——可能是新称呼未登记，也可能指未建档的另一人，登记后称谓检查与 agent 引用即完整。${scope}`
    : `称谓发现核查（本地规则·零模型）：扫描 ${persons.length} 个人物档案 × 常见称谓模式，未发现「正文使用但档案未登记」的疑似称谓。${scope}`
  return { summary, items }
}

// ===== 称谓混用核查（机械层第八块·同章同人称谓混用，零模型，2026-09-15） =====
// 调研结论（The Editor's Blog 2015「Using Names in Fiction」，Beth Hill：#2 Multiple Names for One
// Character——同一个人物使用多个名称必须「克制、有计划、前后一致」；昵称只出现一两次就不值得保留；
// K.M. Weiland「Does Your Story Maintain Consistency in the Details?」（2011-05-11）举 Gaskell《Wives
// & Daughters》例：女主角不同阶段被不同人用不同名字称呼——变名/异称可以有叙事理由（关系/视角变化），
// 但**同章叙述层来回切换**通常是失控；ProWritingAid 的一致性报告只到「拼写/大小写/数字」文字级，
// 无法识别「韩青=韩师傅=老韩」——织卷人物档案自带姓名/别名映射，可自动归属。
// 与传统检测不同的是只看**叙述层（引号外）**：对话中人物互相称呼多变是正常的（韩师傅在对话里被叫
// 「韩师傅」、被叫「老韩」都不算混用），叙述层才是作者用称失控的高发区。
// 判据（2026-09-15 06:00 轮判框架 + 本轮细化）：同章内同一人物在叙述层使用 ≥2 种不同称呼、且
// 交替（相邻出现即换称呼）≥3 次才提示；措辞「可能刻意」（自由间接引语/视角切换下异称有叙事语义，
// 见 Wikipedia Free indirect speech——叙述者可「roam from viewpoint to viewpoint」）。
// 口径边界（机械层承认局限）：单字名/代号（无姓可识别）不参与；同一称呼串被多人「声明」
// （本名/登记别名/姓+称谓生成）→ 归属不明，不参与（避免指认错误）；三字人名「姓+单字」被当称谓的
// 误报方向安全（low 级）；引号不成对时该段仍按叙述层算（漏报方向安全）。

/** 剥成对引号内容（对话层）——「“…””“…”“「…」”“『…』”“‘…’”；不成对不剥（漏报方向安全），替换为空格防拼接 */
export function stripDialogue(text: string): string {
  let t = text
  for (const re of [/“[^”]*”/g, /"[^"]*"/g, /「[^」]*」/g, /『[^』]*』/g, /‘[^’]*’/g]) {
    t = t.replace(re, ' ')
  }
  return t
}

interface MixVariant {
  v: string
  /** 分类：全名 / 登记别名 / 姓+称谓 / 老·小·阿·大+姓 */
  kind: 'name' | 'alias' | 'title' | 'pref'
}

/**
 * 称谓混用核查：输入全部章节、人物档案题名与登记别名表，输出 AuditResult（与审计抽屉同构）。
 * 只扫叙述层（引号外）；同一人物的称呼串（本名/登记别名/生成称谓）须「唯一归属」该人物；
 * 同章内不同称呼交替 ≥3 次 → low（措辞「可能刻意」，带 target 可转提案/让 agent 改）。
 */
export function nameMixCheck(opts: {
  knownChars: string[]
  aliasMap?: Record<string, string[]>
  chapters: PresenceChapter[]
  /** 人物档原文（按人物名）——提供时称谓类条目构造「可执行别名登记提案」 */
  rawChars?: Record<string, string>
}): AuditResult {
  const aliasMap = opts.aliasMap ?? {}
  const persons: PersonInfo[] = []
  for (const n of opts.knownChars) {
    if (n.length < 2) continue
    const sur = surnameOf(n)
    if (sur) persons.push({ name: n, surname: sur })
  }
  if (!persons.length) {
    return {
      summary:
        '称谓混用核查（本地规则·零模型）：项目里没有可从名字识别出姓的人物档案（单字名/代号/无常见姓不参与），没有可核查对象。',
      items: []
    }
  }

  // 声明表：称呼串 → 声明者集合（本名/登记别名/生成称谓都是「声明」；>1 人声明 = 归属不明）
  const declare = new Map<string, Set<PersonInfo>>()
  const declareOne = (v: string, p: PersonInfo) => {
    const s = declare.get(v) ?? new Set<PersonInfo>()
    s.add(p)
    declare.set(v, s)
  }
  for (const p of persons) {
    declareOne(p.name, p)
    for (const a of aliasMap[p.name] ?? []) if (a.length >= 2) declareOne(a, p)
    for (const suf of SUFFIXES) if ((p.surname + suf).length >= 2) declareOne(p.surname + suf, p)
    for (const pre of PREFIXES) declareOne(pre + p.surname, p)
  }
  // 每人物可用变体：唯一归属自己的称呼串（去重；毛刺=声明者集合恰好只有自己）
  const variantsByPerson = new Map<string, MixVariant[]>()
  for (const p of persons) {
    const own: MixVariant[] = []
    const seen = new Set<string>()
    const tryAdd = (v: string, kind: MixVariant['kind']) => {
      if (seen.has(v) || v.length < 2) return
      if (v === '') return
      const owners = declare.get(v)
      if (!owners || owners.size !== 1 || !owners.has(p)) return
      seen.add(v)
      own.push({ v, kind })
    }
    tryAdd(p.name, 'name')
    for (const a of aliasMap[p.name] ?? []) tryAdd(a, 'alias')
    for (const suf of SUFFIXES) tryAdd(p.surname + suf, 'title')
    for (const pre of PREFIXES) tryAdd(pre + p.surname, 'pref')
    if (own.length >= 2) variantsByPerson.set(p.name, own)
  }
  if (!variantsByPerson.size) {
    return {
      summary: `称谓混用核查（本地规则·零模型）：扫描 ${persons.length} 个人物档案 × 全卷正文，没有人物拥有 ≥2 种可识别的称呼（唯一归属），无可核查对象。`,
      items: []
    }
  }

  const items: AuditItem[] = []
  for (const ch of opts.chapters) {
    const { fm, body } = extractFrontMatter(ch.raw)
    const text = stripDialogue(stripHtmlComments(body))
    if (!text) continue
    for (const p of persons) {
      const variants = variantsByPerson.get(p.name)
      if (!variants) continue
      const sorted = [...variants].sort((a, b) => b.v.length - a.v.length)
      const re = new RegExp(sorted.map((x) => escRe(x.v)).join('|'), 'g')
      const refs: { v: string; pos: number }[] = []
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        refs.push({ v: m[0], pos: m.index })
      }
      if (refs.length < 3) continue
      let switches = 0
      let firstSwitch = -1
      for (let i = 1; i < refs.length; i++) {
        if (refs[i].v !== refs[i - 1].v) {
          switches++
          if (firstSwitch < 0) firstSwitch = i
        }
      }
      if (switches < 3 || firstSwitch < 0) continue
      const shown = [...new Set(refs.map((r) => r.v))]
      const candidates = shown.filter((v) => v !== p.name && !(aliasMap[p.name] ?? []).includes(v))
      const ctx = clipCtx(text, refs[firstSwitch].pos, refs[firstSwitch].v.length)
      items.push({
        severity: 'low',
        type: 'character',
        where: `${titleOf(fm, ch.file)}（${ch.file}）`,
        what: `本章叙述层交替使用了「${shown.join('」「')}」等 ${shown.length} 种称呼指「${p.name}」（共 ${refs.length} 处、交替 ${switches} 次）——若并非刻意（如人物关系变化、视角切换，自由间接引语下的异称有叙事语义），多个称呼混用容易让读者出戏。交替处：「…${ctx}…」。`,
        suggest: `确认「${p.name}」在本章的称呼：若几种称呼都有叙事用意可保留；否则把叙述层统一为一两种，有意使用的其他称呼可登记到 人物/${p.name}.md 约定头「别名: [...]」，使称谓检查与 agent 引用识别它们。`,
        target: `人物/${p.name}.md`,
        aliasCandidates: candidates,
        proposal: aliasProposal(opts.rawChars, p.name, candidates)
      })
    }
  }
  const scope =
    '口径：扫描叙述层（引号外）；参与=本名/登记别名/姓+称谓/老·小·阿·大+姓；单字名、代号与归属不明（多主声明）不参与；同章内不同称呼交替 ≥3 次才提示。'
  const summary = items.length
    ? `称谓混用核查（本地规则·零模型）：扫描 ${persons.length} 个人物档案 × 全卷正文，发现 ${items.length} 章「同章叙述层交替使用多个称呼指同一人」——若并非刻意建议统一，避免读者出戏。${scope}`
    : `称谓混用核查（本地规则·零模型）：扫描 ${persons.length} 个人物档案 × 全卷正文，未发现同章内交替使用多个称呼的情况。${scope}`
  return { summary, items }
}
