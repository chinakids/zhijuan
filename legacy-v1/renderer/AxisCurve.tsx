import { useRef } from 'react'
import type { CurveAxis, CurvePoint } from '../../../shared/types'

interface Props {
  axis: CurveAxis
  color: string
  onChange: (a: CurveAxis) => void
  onRemove: () => void
}

const W = 560
const H = 150
const PAD = 18

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

/** 一根可拖拽的行为轴曲线：名字可随便改，曲线的起伏就是这个角色在这条轴上的状态走向 */
export default function AxisCurve({ axis, color, onChange, onRemove }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<number | null>(null)

  function posOf(e: React.PointerEvent | React.MouseEvent): { x: number; y: number } | null {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const scaleX = W / rect.width
    const scaleY = H / rect.height
    return inv((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY)
  }

  function beginDrag(e: React.PointerEvent, idx: number) {
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = idx
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  function moveDrag(e: React.PointerEvent) {
    const idx = dragRef.current
    if (idx === null) return
    const p = posOf(e)
    if (!p) return
    const pts = [...axis.points]
    pts[idx] = { x: Math.round(p.x), y: Math.round(p.y), label: pts[idx]?.label }
    onChange({ ...axis, points: pts })
  }

  function endDrag() {
    dragRef.current = null
  }

  function addPoint(e: React.PointerEvent) {
    const p = posOf(e)
    if (!p) return
    onChange({ ...axis, points: [...axis.points, { x: Math.round(p.x), y: Math.round(p.y) }] })
  }

  return (
    <div className="axis-curve">
      <div className="axis-curve-head">
        <input
          className="axis-name"
          value={axis.name}
          title="这根轴的名称（自由填）：它在值轴上代表什么——如她的主动权、他的压迫感、两人距离"
          onChange={(e) => onChange({ ...axis, name: e.target.value })}
        />
        <span className="muted">拖拽曲线 = 调节这个角色在各章节阶段的档位</span>
        <button className="btn btn-sm btn-danger" onClick={onRemove} title="删除这根轴">
          ✕
        </button>
      </div>
      <svg
        ref={svgRef}
        className="curve-svg axis-svg"
        viewBox={`0 0 ${W} ${H}`}
        onPointerDown={(e) => {
          if ((e.target as Element).getAttribute('data-pt') === '1') return // 交由控制点自己处理
          addPoint(e)
        }}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        {[25, 50, 75].map((g) => (
          <g key={g} className="grid">
            <line x1={PAD} y1={pt(0, g).y} x2={W - PAD} y2={pt(0, g).y} />
          </g>
        ))}
        <path d={pathOf(axis.points)} className="axis-path" stroke={color} />
        {axis.points.map((p, i) => (
          <circle
            key={i}
            data-pt="1"
            className="ctrl-pt"
            cx={pt(p.x, p.y).x}
            cy={pt(p.x, p.y).y}
            r={5}
            fill={color}
            onPointerDown={(e) => beginDrag(e, i)}
          />
        ))}
      </svg>
    </div>
  )
}
