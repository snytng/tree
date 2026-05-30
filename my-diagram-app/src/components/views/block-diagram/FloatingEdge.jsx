import React from 'react';
import { useStore, getBezierPath, BaseEdge, EdgeLabelRenderer, Position } from 'reactflow';

/* ── 形状別ポリゴン（中心原点・unrotated） ────────────────
   各頂点は中心を (0,0) としたローカル座標。
   ShapeNode.jsx の描画座標系と一致させること。
──────────────────────────────────────────────────────── */
function getPolygon(shape, w, h) {
  const w2 = w / 2, h2 = h / 2;
  switch (shape) {
    case 'diamond':
      return [
        { x:   0, y: -h2 }, { x:  w2, y:   0 },
        { x:   0, y:  h2 }, { x: -w2, y:   0 },
      ];
    case 'parallelogram': {
      const off = 16; // ShapeNode と同じオフセット
      return [
        { x: off - w2, y: -h2 }, { x:       w2, y: -h2 },
        { x: w2 - off, y:  h2 }, { x:      -w2, y:  h2 },
      ];
    }
    case 'hexagon': {
      const q = w / 4; // ShapeNode と同じ q = w/4
      return [
        { x:  q - w2, y: -h2 }, { x: w2 -  q, y: -h2 },
        { x:      w2, y:   0 },
        { x: w2 -  q, y:  h2 }, { x:  q - w2, y:  h2 },
        { x:     -w2, y:   0 },
      ];
    }
    default: // rect, rounded, cylinder
      return [
        { x: -w2, y: -h2 }, { x: w2, y: -h2 },
        { x:  w2, y:  h2 }, { x: -w2, y:  h2 },
      ];
  }
}

/**
 * ポリゴンと原点からの方向ベクトル (cosθ, sinθ) との最初の交点を求める。
 *
 * 方程式: t*(cos, sin) = A + s*(B - A)
 * Cramer's rule で t, s を解く。
 *   det = dx*sin - dy*cos
 *   t   = (A.y*dx - A.x*dy) / det
 *   s   = (cos*A.y - sin*A.x) / det
 */
function polygonRayIntersect(polygon, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let best  = null;
  let bestT = Infinity;

  for (let i = 0; i < polygon.length; i++) {
    const A  = polygon[i];
    const B  = polygon[(i + 1) % polygon.length];
    const dx = B.x - A.x;
    const dy = B.y - A.y;

    const det = dx * sin - dy * cos;
    if (Math.abs(det) < 1e-10) continue;

    const t = (A.y * dx - A.x * dy) / det;
    const s = (cos * A.y - sin * A.x) / det;

    if (t > 1e-10 && s >= -1e-10 && s <= 1 + 1e-10 && t < bestT) {
      bestT = t;
      best  = { x: t * cos, y: t * sin };
    }
  }
  // フォールバック: 中心から一定距離
  return best ?? { x: cos * 40, y: sin * 40 };
}

/**
 * ノードの境界とワールド角度の交点をワールド座標で返す。
 * ノードの CSS 回転 (data.rotation) を考慮してローカル座標系で計算し、
 * 結果をワールド座標に変換する。
 */
function getBorderPoint(node, worldAngle) {
  const w     = node.width  ?? node.data?.width  ?? 160;
  const h     = node.height ?? node.data?.height ?? 60;
  const shape = node.data?.shape    ?? 'rect';
  const rotRad = ((node.data?.rotation ?? 0) * Math.PI) / 180;

  // ワールド角度をノードのローカル角度に変換
  const localAngle = worldAngle - rotRad;

  let lp; // ローカル座標での境界点
  if (shape === 'ellipse') {
    const rx = w / 2, ry = h / 2;
    const c   = Math.cos(localAngle);
    const s   = Math.sin(localAngle);
    const len = Math.sqrt((c / rx) ** 2 + (s / ry) ** 2);
    const t   = len < 1e-10 ? rx : 1 / len;
    lp = { x: t * c, y: t * s };
  } else {
    lp = polygonRayIntersect(getPolygon(shape, w, h), localAngle);
  }

  // ローカル点をノード回転に合わせてワールド座標へ変換
  const cosR = Math.cos(rotRad);
  const sinR = Math.sin(rotRad);
  const pos  = node.positionAbsolute ?? node.position;
  const cx   = pos.x + w / 2;
  const cy   = pos.y + h / 2;

  return {
    x: cx + lp.x * cosR - lp.y * sinR,
    y: cy + lp.x * sinR + lp.y * cosR,
  };
}

/** ワールド角度から ReactFlow の Position を推定（ベジェカーブの向き用） */
function angleToPosition(angle) {
  const deg = ((angle * 180 / Math.PI) % 360 + 360) % 360;
  if (deg >= 315 || deg <  45) return Position.Right;
  if (deg >=  45 && deg < 135) return Position.Bottom;
  if (deg >= 135 && deg < 225) return Position.Left;
  return Position.Top; // 225–315
}

/**
 * フローティングエッジ。
 * 接続先ノードの形状・回転を考慮して境界交点を動的に計算し、
 * ノードを移動しても自動的に最適な接続位置へ調整される。
 */
export default function FloatingEdge({ id, source, target, markerEnd, style, label }) {
  const sourceNode = useStore(s => s.nodeInternals.get(source));
  const targetNode = useStore(s => s.nodeInternals.get(target));

  if (!sourceNode || !targetNode) return null;

  const sw = sourceNode.width  ?? sourceNode.data?.width  ?? 160;
  const sh = sourceNode.height ?? sourceNode.data?.height ?? 60;
  const tw = targetNode.width  ?? targetNode.data?.width  ?? 160;
  const th = targetNode.height ?? targetNode.data?.height ?? 60;

  const sp0 = sourceNode.positionAbsolute ?? sourceNode.position;
  const tp0 = targetNode.positionAbsolute ?? targetNode.position;

  const scx = sp0.x + sw / 2;
  const scy = sp0.y + sh / 2;
  const tcx = tp0.x + tw / 2;
  const tcy = tp0.y + th / 2;

  // 自己ループはスキップ
  if (Math.abs(tcx - scx) < 1 && Math.abs(tcy - scy) < 1) return null;

  const angle = Math.atan2(tcy - scy, tcx - scx);

  const sp = getBorderPoint(sourceNode, angle);
  const tp = getBorderPoint(targetNode, angle + Math.PI);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: sp.x, sourceY: sp.y, sourcePosition: angleToPosition(angle),
    targetX: tp.x, targetY: tp.y, targetPosition: angleToPosition(angle + Math.PI),
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div style={{
            position:  'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            background: '#fff',
            border:     '1px solid #e5e7eb',
            borderRadius: 4,
            padding:    '2px 6px',
            fontSize:   11,
            color:      '#374151',
            pointerEvents: 'all',
          }}>
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
