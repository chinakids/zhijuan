import { useRef } from 'react'
import type { SeriesCurve, CurvePoint, PlotBeat } from '../../../shared/types'
import { AXIS_LIBRARY, AXIS_ORDER } from '../../../shared/axes'

interface Props {
  curve: SeriesCurve
  beats: PlotBeat[]
  onChange: (points: CurvePoint[]) => void
  onAxisChange?: (axis: string) => void
  onAddBeat: (x: number) => void
  onRemoveBeat: (id: string) => void
}

const W = 640
const H = 300
const PAD = 24

function pt(px: number, py: number) {
  return {
    x: PAD + (px / 100) * (W - PAD * 2),
    y: H - PAD - (py / 100) * (H - PAD * 2)
  }
}

function inv(px: number, py: number) {
  return {
    x: Math.min(100, Math.max(0, ((px - PAD) / (W - PAD * 2)) * 100)),
    y: Math.min(100, Math.max(0, ((H - PAD - py) / (H - PAD * 2)) * 100))
  }
}

function pathOf(points: CurvePoint[]): string {
  if (points.length === 0) return ''
  const sorted = [...points].sort((a, b) => a.x - b.x)
  const s = pt(sorted[0].x, sorted[0].y)
  let d = `M ${s.x} ${s.y}`
  for (let i = 1; i < sorted.length; i++) {
    const p = pt(sorted[i].x, sorted[i].y)
    const p0 = pt(sorted[i - 1].x, sorted[i - 1].y)
    const mx = (p0.x + p.x) / 2
    d += ` Q ${mx} ${p0.y}, ${p.x} ${p.y}`
  }
  return d
}

export default function CurveEditor({ curve, beats, onChange, onAxisChange, onAddBeat, onRemoveBeat }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<number | null>(null) // 正在拖拽的控制点索引

  function posOf(e: React.PointerEvent): { x: number; y: number } | null {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const scaleX = W / rect.width
    const scaleY = H / rect.height
    return inv((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY)
  }

  function handleDown(e: React.PointerEvent, idx: number) {
    e.stopPropagation()
    dragRef.current = idx
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  function handleMove(e: React.PointerEvent) {
    if (dragRef.current === null) return
    const p = posOf(e)
    if (!p) return
    const idx = dragRef.current
    const pts = curve.points.map((cp, i) =>
      i === idx ? { ...cp, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 } : cp
    )
    // 保持 x 单调，防止曲线交叉
    const sorted = [...pts].sort((a, b) => a.x - b.x)
    onChange(sorted)
  }

  function handleUp() {
    dragRef.current = null
  }

  function handleAddPoint(e: React.PointerEvent) {
    const p = posOf(e)
    if (!p || dragRef.current !== null) return
    onChange([...curve.points, { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }])
  }

  function handleBeat(e: React.PointerEvent) {
    const p = posOf(e)
    if (p) onAddBeat(Math.round(p.x))
  }

  function dblClickPoint(e: React.MouseEvent, idx: number) {
    e.stopPropagation()
    onChange(curve.points.filter((_, i) => i !== idx))
  }

  return (
    <div className="curve-box">
      <div className={`curve-title ${curve.color}`}>
        <span className="dot" style={{ background: curve.color }} />
        {curve.kind === 'emotion' ? '情绪' : '人物'}曲线：{curve.name}
        {curve.kind === 'character' && onAxisChange && (
          <label className="axis-select" title="把这条人物曲线的数值翻译成该角色的可写动作要求（不同强度档位给出不同的动作硬命令），进生成 prompt">
            行为轴
            <select
              value={curve.axis ?? ''}
              onChange={(e) => onAxisChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">不声明（只报趋势）</option>
              {AXIS_ORDER.map((id) => (
                <option key={id} value={id} title={AXIS_LIBRARY[id].hint}>
                  {AXIS_LIBRARY[id].label}（{AXIS_LIBRARY[id].subject}）
                </option>
              ))}
            </select>
          </label>
        )}
        <small>
          （点击空处加点，拖拽移动，双击删点；右侧栏在此曲线位置按情节点）
        </small>
      </div>
      <svg
        ref={svgRef}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="curve-svg"
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerLeave={handleUp}
        onPointerDown={handleAddPoint}
      >
        {/* 网格 */}
        {[0, 1, 2, 3, 4].map((i) => {
          const y = PAD + (i / 4) * (H - PAD * 2)
          return <line key={i} x1={PAD} x2={W - PAD} y1={y} y2={y} className="grid" />
        })}
        {Array.from({ length: 10 }).map((_, i) => {
          const x = PAD + (i / 9) * (W - PAD * 2)
          return <line key={i} x1={x} x2={x} y1={PAD} y2={H - PAD} className="grid" />
        })}
        {/* 情节点刻度（竖虚线 + 小旗） */}
        {beats.map((b) => {
          const p = pt(b.at, 0)
          return (
            <g key={b.id} className="beat" onClick={(e) => e.stopPropagation()}>
              <line x1={p.x} x2={p.x} y1={PAD} y2={H - PAD} className="beat-line" />
              <circle cx={p.x} cy={PAD + 8} r={4} fill="#ffd166" />
              <text x={p.x} y={PAD - 8} textAnchor="middle" className="beat-label">
                {b.label}
              </text>
              <title>{b.label} — {b.note}</title>
            </g>
          )
        })}
        {/* 连线 */}
        <path d={pathOf(curve.points)} stroke={curve.color} className="curve-path" />
        {/* 控制点 */}
        {curve.points.map((p, i) => {
          const pos = pt(p.x, p.y)
          return (
            <circle
              key={i}
              cx={pos.x}
              cy={pos.y}
              r={7}
              fill={curve.color}
              className="ctrl-pt"
              onPointerDown={(e) => handleDown(e, i)}
              onDoubleClick={(e) => dblClickPoint(e, i)}
            />
          )
        })}
        {curve.points.length === 0 && (
          <text x={W / 2} y={H / 2} textAnchor="middle" className="empty-tip">
            点击画面添加控制点，画出本章的曲线走向
          </text>
        )}
      </svg>
    </div>
  )
}
