// 织卷 · 人物曲线行为轴（axes）· 纯逻辑（无 Electron 依赖）
// M2.3：把「人物曲线」从抽象状态升格为「行为轴」。
// 一条人物曲线声明它的轴（她的主动权 / 他的压迫感 / 两人距离…），每个强度区间都有对应的
// 「可写动作要求」——采样值不再是数字，而是导演写给该角色的动作指令，直接进 prompt。
// 轴的措辞按主人的创作风格写的：感官细节为主、动作直白，主线女角细腻、娇而带韧。

/** 一个强度档位：强度落在 [min, 100] 且高于下一档时，用本档的动作要求 */
export interface AxisBand {
  min: number // 本档强度下限（含）；档位按 min 升序，须完整覆盖 0..100
  label: string // 档位名（如：由她主导 / 有来有回 / 被牵着走）
  demand: string // 该强度区间的可写动作要求（具体到动作、眼神、声音、身体反应）
}

/** 一条轴：曲线名是「谁」，轴定义「这条线的数值意味着什么动作」 */
export interface CharacterAxis {
  id: string
  label: string // 轴名（进 UI 与 prompt）
  hint: string // 轴的含义（UI 悬浮说明用）
  subject: '她' | '他' | '两人' // 视角主语，只用于说明
  bands: AxisBand[]
}

/** 预设行为轴库：按主人风格编排（主线以女性角色为主视角，故多数轴以「她」为主语措辞） */
export const AXIS_LIBRARY: Record<string, CharacterAxis> = {
  initiative: {
    id: 'initiative',
    label: '主动权',
    hint: '她的主动权有多高——谁在主导每一次靠近、开口与进退',
    subject: '她',
    bands: [
      {
        min: 0,
        label: '被牵着走',
        demand: '主动权全在对方手里：她只能回应、跟随、被带入，每一个动作都是被引着做的，连她自己都察觉的微弱抗拒反而把被动写得更真'
      },
      {
        min: 35,
        label: '有来有回',
        demand: '她会接、会回嘴、会在边缘试探自己的分量，有几下甚至反着要回来，但终究还是被带着走——这个拉扯要有具体的身体细节，不是一句话带过'
      },
      {
        min: 70,
        label: '由她主导',
        demand: '主动权在她手里：她先靠近、先开口，节奏攥在手里，每次靠近是她，每次退开也是她，动作带着主动的意味，别把她写成被动的承受者'
      }
    ]
  },
  pressure: {
    id: 'pressure',
    label: '压迫感',
    hint: '他的气势占上风到什么程度——笼罩感、压迫感、占有欲的烈度',
    subject: '他',
    bands: [
      {
        min: 0,
        label: '收敛',
        demand: '他把气势收得很低，只有安静的存在感，不逼她，给足她活动的空间'
      },
      {
        min: 35,
        label: '施压',
        demand: '他不紧不慢地逼近，一言不发地看，空气一寸寸变重，压得她呼吸变浅——压迫要写在氛围和她的反应里，不是嘴上说“我怕”'
      },
      {
        min: 70,
        label: '笼罩',
        demand: '他把她按在原地、俯身罩下来，声音贴在她耳边，动作带着不容拒绝的分量——他占据画面，她缩在他的阴影里，这份笼罩要有体积感和体温'
      }
    ]
  },
  distance: {
    id: 'distance',
    label: '距离',
    hint: '两人身体与心的距离——若即若离，还是严丝合缝',
    subject: '两人',
    bands: [
      {
        min: 0,
        label: '若即若离',
        demand: '看得见够不着：指尖擦过又缩回，衣料将贴未贴，欲近还羞的煎熬要写在每一次差一点就碰到的动作里'
      },
      {
        min: 35,
        label: '留有余地',
        demand: '正常的亲近，肢体有接触但还留着一点分寸——靠近、交叠、又各自让开半步，把那份克制的意味写足'
      },
      {
        min: 70,
        label: '严丝合缝',
        demand: '贴骨相拥，每一处都贴着，逼近到没有间隔——靠近是一寸一寸吞进去的，让读者能感到那份贴合的热与紧'
      }
    ]
  },
  desire: {
    id: 'desire',
    label: '情欲',
    hint: '她身体的诚实程度——这份热是藏不住还是已经烧起来了',
    subject: '她',
    bands: [
      {
        min: 0,
        label: '紧绷',
        demand: '她绷着、咬着唇，目光闪躲，身体还端着——端着的细节要具体，是攥紧的指尖、僵直的背，不是一句笼统的“紧张”'
      },
      {
        min: 35,
        label: '松动',
        demand: '呼吸开始散，眼底有了水光，声音有一丝发颤——藏不住的那点软要写出来，是皮肤先于语言出卖她'
      },
      {
        min: 70,
        label: '决堤',
        demand: '身体比嘴诚实：腿软、腰塌，湿意顺着大腿，细碎的呻吟漏出来，防线的每一道缝都在打开——按感官直写，量要足，别用“很舒服”之类糊过去'
      }
    ]
  },
  shyness: {
    id: 'shyness',
    label: '羞耻防线',
    hint: '她的防线还剩多少——半推半就的拉扯，还是已经由他摆布',
    subject: '她',
    bands: [
      {
        min: 0,
        label: '防线尽失',
        demand: '防线已经没了：她由着他摆布，任他看任他碰，身体放得很开——这时候的重点是放开的彻底与坦然，别再写多余的矜持'
      },
      {
        min: 35,
        label: '欲拒还迎',
        demand: '她嘴上推、身体却诚实，半推半就的拉扯要有具体的身体细节：躲开又贴上，说不却抬了腰——每一句嘴硬都要有一个诚实的身体动作来拆穿'
      },
      {
        min: 70,
        label: '羞到骨里',
        demand: '她绷得紧紧的、脸埋起来、耳根到脖子一片红——羞耻本身就是感官，每一处躲、每一声呜咽都要写得细，越是羞，身体越是敏感，这份反差要写满'
      }
    ]
  }
}

/** 轴在 UI / 文档里的展示顺序 */
export const AXIS_ORDER: string[] = ['initiative', 'pressure', 'distance', 'desire', 'shyness']

/** 按 id 取轴（未知 id 或空则返回 undefined，保持向后兼容） */
export function resolveAxis(id: string | undefined): CharacterAxis | undefined {
  return id ? AXIS_LIBRARY[id] : undefined
}

/**
 * 把曲线的一个采样值翻译成该角色的可写动作要求。
 * 无轴 / 未知轴返回 undefined（该曲线维持“只报趋势”的旧行为）；
 * 档位匹配：取「min ≤ 值」的最高档（值取向上涨到哪一档就按哪一档写）。
 */
export function axisDemand(
  id: string | undefined,
  value: number
): { label: string; demand: string } | undefined {
  const ax = resolveAxis(id)
  if (!ax || !Array.isArray(ax.bands) || ax.bands.length === 0) return undefined
  let hit: AxisBand | undefined
  for (const b of ax.bands) {
    if (value >= b.min) hit = b
  }
  if (!hit) hit = ax.bands[0]
  return { label: `${ax.label}·${hit.label}`, demand: hit.demand }
}
