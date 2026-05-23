import React from 'react';
import { getBezierPath } from 'reactflow';

export default function RubberBandEdge({
  sourceX,
  sourceY,
  sourcePosition,
  data,
}) {
  // 始点ハンドルから現在のマウス座標（論理座標）までのパスを計算
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX: data.mousePos.x,
    targetY: data.mousePos.y,
    targetPosition: sourcePosition, // マウス追従時は始点と同じ方向を向かせると自然
  });

  return (
    <g className="react-flow__edge rubber-band-edge">
      <path
        className="react-flow__edge-path rubber-band-edge-path"
        d={edgePath}
      />
    </g>
  );
}