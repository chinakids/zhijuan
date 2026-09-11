// 空态装饰插图（V-05 空态插画）：低饱和「纸雕」风小型 SVG，无新依赖。
// 配色全走 tokens CSS 变量（亮暗主题自动跟随）；仅 devShim/真机同一组件。
// 语义：安静、与品牌（暖纸面+青黛）一致——不抢视线，只消解「页面还没准备好」的空白感。
// 参考：Material Design Empty states（图像应中性/与品牌一致，勿紧迫勿困惑）。

export type ArtVariant =
  | 'library' // 项目库（书）
  | 'chapter' // 正文章节（纸+笔）
  | 'character' // 角色档案（人形）
  | 'world' // 世界观（山月）
  | 'timeline' // 时间线（节点连线）
  | 'material' // 素材库（文件夹+星）
  | 'outline' // 大纲（卡片列表）
  | 'search' // 搜索无结果（放大镜）

const ink3 = 'var(--ink-3)'
const hair = 'var(--hair-strong)'
const surf = 'var(--surface)'
const accent = 'var(--accent)'
const accentSoft = 'var(--accent-soft)'

function artOf(v: ArtVariant) {
  switch (v) {
    case 'library':
      return (
        <>
          {/* 两本书：一伏一立 */}
          <rect x="26" y="42" width="24" height="30" rx="3" style={{ fill: surf, stroke: hair, strokeWidth: 1.5 }} />
          <line x1="33" y1="42" x2="33" y2="72" style={{ stroke: ink3, strokeWidth: 1.5 }} />
          <circle cx="38" cy="56" r="2.5" style={{ fill: accent }} />
          <rect x="52" y="46" width="18" height="26" rx="3" style={{ fill: accentSoft, stroke: accent, strokeOpacity: 0.45, strokeWidth: 1.5 }} />
          <line x1="61" y1="46" x2="61" y2="72" style={{ stroke: accent, strokeOpacity: 0.45, strokeWidth: 1.5 }} />
          <circle cx="23" cy="38" r="1.75" style={{ fill: accent, opacity: 0.55 }} />
          <circle cx="72" cy="38" r="1.75" style={{ fill: ink3, opacity: 0.5 }} />
        </>
      )
    case 'chapter':
      return (
        <>
          {/* 纸页 + 笔尖 */}
          <rect x="26" y="24" width="34" height="46" rx="3" style={{ fill: surf, stroke: hair, strokeWidth: 1.5 }} />
          <line x1="33" y1="34" x2="53" y2="34" style={{ stroke: ink3, strokeWidth: 1.5 }} />
          <line x1="33" y1="41" x2="53" y2="41" style={{ stroke: ink3, strokeWidth: 1.5 }} />
          <line x1="33" y1="48" x2="47" y2="48" style={{ stroke: ink3, strokeWidth: 1.5 }} />
          <circle cx="33" cy="60" r="2.5" style={{ fill: accent }} />
          <line x1="38" y1="60" x2="46" y2="60" style={{ stroke: ink3, strokeWidth: 1.5 }} />
          {/* 笔：斜置，笔尖朝纸 */}
          <line x1="58" y1="58" x2="72" y2="44" style={{ stroke: accent, strokeWidth: 2.5, strokeLinecap: 'round' }} />
          <path d="M72 44 L66 52 L60 50 Z" style={{ fill: accentSoft, stroke: accent, strokeWidth: 1.5, strokeLinejoin: 'round' }} />
          <circle cx="23" cy="46" r="1.75" style={{ fill: accent, opacity: 0.55 }} />
        </>
      )
    case 'character':
      return (
        <>
          {/* 人物：头像 + 肩线（档案感） */}
          <circle cx="48" cy="37" r="12" style={{ fill: accentSoft, stroke: accent, strokeOpacity: 0.5, strokeWidth: 1.5 }} />
          <circle cx="43" cy="34" r="1.25" style={{ fill: accent }} />
          <circle cx="53" cy="34" r="1.25" style={{ fill: accent }} />
          <path d="M44 41 Q48 44 52 41" style={{ fill: 'none', stroke: accent, strokeWidth: 1.5, strokeLinecap: 'round' }} />
          <path d="M32 70 Q48 54 64 70" style={{ fill: 'none', stroke: ink3, strokeWidth: 1.75, strokeLinecap: 'round' }} />
          <rect x="44" y="64" width="8" height="8" rx="2" style={{ fill: surf, stroke: hair, strokeWidth: 1.5 }} />
          <circle cx="24" cy="52" r="1.75" style={{ fill: accent, opacity: 0.55 }} />
          <circle cx="72" cy="58" r="1.75" style={{ fill: ink3, opacity: 0.5 }} />
        </>
      )
    case 'world':
      return (
        <>
          {/* 山 + 月 + 星 */}
          <path d="M20 66 L44 34 L58 52 L70 40 L84 66 Z" style={{ fill: accentSoft, stroke: accent, strokeOpacity: 0.5, strokeWidth: 1.5, strokeLinejoin: 'round' }} />
          <circle cx="67" cy="31" r="8" style={{ fill: surf, stroke: hair, strokeWidth: 1.5 }} />
          <circle cx="64" cy="29" r="2" style={{ fill: accent, opacity: 0.5 }} />
          <path d="M28 40 l1.5 3 3 1.5 -3 1.5 -1.5 3 -1.5 -3 -3 -1.5 3 -1.5 Z" style={{ fill: accent, opacity: 0.6 }} />
          <path d="M36 30 l1.2 2.4 2.4 1.2 -2.4 1.2 -1.2 2.4 -1.2 -2.4 -2.4 -1.2 2.4 -1.2 Z" style={{ fill: ink3, opacity: 0.55 }} />
        </>
      )
    case 'timeline':
      return (
        <>
          {/* 时间轴：三节点，中间为「当前」 */}
          <line x1="22" y1="48" x2="74" y2="48" style={{ stroke: ink3, strokeWidth: 1.5 }} />
          <circle cx="32" cy="48" r="5.5" style={{ fill: surf, stroke: hair, strokeWidth: 1.5 }} />
          <circle cx="48" cy="48" r="5.5" style={{ fill: accent, opacity: 0.85 }} />
          <circle cx="64" cy="48" r="5.5" style={{ fill: surf, stroke: hair, strokeWidth: 1.5 }} />
          <line x1="48" y1="32" x2="48" y2="42.5" style={{ stroke: accent, strokeWidth: 1.5 }} />
          <circle cx="48" cy="29" r="2.5" style={{ fill: accent, opacity: 0.6 }} />
          <line x1="26" y1="66" x2="42" y2="66" style={{ stroke: ink3, strokeWidth: 1.5, opacity: 0.6 }} />
          <line x1="54" y1="66" x2="70" y2="66" style={{ stroke: ink3, strokeWidth: 1.5, opacity: 0.6 }} />
        </>
      )
    case 'material':
      return (
        <>
          {/* 文件夹 + 星（素材收藏） */}
          <path
            d="M24 68 V36 a3 3 0 0 1 3 -3 h13 l4.5 5 h23 a3 3 0 0 1 3 3 v27 a3 3 0 0 1 -3 3 h-40 a3 3 0 0 1 -3 -3 Z"
            style={{ fill: surf, stroke: hair, strokeWidth: 1.5, strokeLinejoin: 'round' }}
          />
          <path
            d="M52 42 l3 6 6.5 1 -4.7 4.6 1.1 6.6 -5.9 -3.1 -5.9 3.1 1.1 -6.6 -4.7 -4.6 6.5 -1 Z"
            style={{ fill: accent, opacity: 0.7 }}
          />
          <circle cx="31" cy="47" r="1.75" style={{ fill: ink3, opacity: 0.55 }} />
          <circle cx="38" cy="47" r="1.75" style={{ fill: ink3, opacity: 0.55 }} />
        </>
      )
    case 'outline':
      return (
        <>
          {/* 章卡列表：三张卡 + 完成勾 */}
          <rect x="28" y="26" width="40" height="11" rx="2.5" style={{ fill: accentSoft, stroke: accent, strokeOpacity: 0.5, strokeWidth: 1.5 }} />
          <circle cx="34" cy="31.5" r="3" style={{ fill: surf, stroke: accent, strokeWidth: 1.5 }} />
          <path d="M32.5 31.5 l1.2 1.2 2.2 -2.4" style={{ fill: 'none', stroke: accent, strokeWidth: 1.5, strokeLinecap: 'round' }} />
          <rect x="28" y="43" width="40" height="11" rx="2.5" style={{ fill: surf, stroke: hair, strokeWidth: 1.5 }} />
          <line x1="36" y1="48.5" x2="60" y2="48.5" style={{ stroke: ink3, strokeWidth: 1.5 }} />
          <rect x="28" y="60" width="40" height="11" rx="2.5" style={{ fill: surf, stroke: hair, strokeWidth: 1.5 }} />
          <line x1="36" y1="65.5" x2="56" y2="65.5" style={{ stroke: ink3, strokeWidth: 1.5 }} />
        </>
      )
    case 'search':
      return (
        <>
          {/* 放大镜 + 纸：搜索无结果 */}
          <rect x="26" y="26" width="30" height="38" rx="3" style={{ fill: surf, stroke: hair, strokeWidth: 1.5 }} />
          <line x1="33" y1="36" x2="49" y2="36" style={{ stroke: ink3, strokeWidth: 1.5 }} />
          <line x1="33" y1="43" x2="49" y2="43" style={{ stroke: ink3, strokeWidth: 1.5 }} />
          <line x1="33" y1="50" x2="43" y2="50" style={{ stroke: ink3, strokeWidth: 1.5 }} />
          <circle cx="58" cy="53" r="9.5" style={{ fill: 'none', stroke: ink3, strokeWidth: 1.75 }} />
          <circle cx="56" cy="51" r="2" style={{ fill: accent }} />
          <line x1="65" y1="60" x2="72" y2="67" style={{ stroke: ink3, strokeWidth: 1.75, strokeLinecap: 'round' }} />
        </>
      )
  }
}

export function EmptyArt({ variant, className }: { variant: ArtVariant; className?: string }) {
  return (
    <svg viewBox="0 0 96 96" width="88" height="88" className={className} aria-hidden="true" data-zj-art={variant}>
      <rect x="6" y="6" width="84" height="84" rx="22" style={{ fill: accentSoft, opacity: 0.55 }} />
      {artOf(variant)}
    </svg>
  )
}
