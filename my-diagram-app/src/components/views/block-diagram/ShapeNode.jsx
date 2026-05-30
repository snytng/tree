import React, { useCallback } from 'react';
import { Handle, Position } from 'reactflow';
import { NodeResizer } from '@reactflow/node-resizer';
import '@reactflow/node-resizer/dist/style.css';

/** SVG 形状を描画する純粋関数 */
function renderShape(type, w, h, fill, stroke, sw) {
  const s = sw / 2; // stroke-width 分のオフセット（クリッピング防止）

  switch (type) {
    case 'rounded':
      return (
        <rect x={s} y={s} width={w - sw} height={h - sw}
          rx={12} ry={12} fill={fill} stroke={stroke} strokeWidth={sw} />
      );

    case 'diamond': {
      const pts = `${w / 2},${s} ${w - s},${h / 2} ${w / 2},${h - s} ${s},${h / 2}`;
      return <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />;
    }

    case 'ellipse':
      return (
        <ellipse cx={w / 2} cy={h / 2}
          rx={(w - sw) / 2} ry={(h - sw) / 2}
          fill={fill} stroke={stroke} strokeWidth={sw} />
      );

    case 'parallelogram': {
      const off = 16;
      const pts = `${off + s},${s} ${w - s},${s} ${w - off - s},${h - s} ${s},${h - s}`;
      return <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />;
    }

    case 'hexagon': {
      const q = w / 4;
      const pts = `${q + s},${s} ${w - q - s},${s} ${w - s},${h / 2} ${w - q - s},${h - s} ${q + s},${h - s} ${s},${h / 2}`;
      return <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />;
    }

    case 'cylinder': {
      const ry = Math.min(13, h * 0.18);
      return (
        <g>
          {/* 側面（塗り） */}
          <rect x={s} y={ry} width={w - sw} height={h - ry * 2} fill={fill} stroke="none" />
          {/* 底面楕円（塗り） */}
          <ellipse cx={w / 2} cy={h - ry} rx={(w - sw) / 2} ry={ry} fill={fill} stroke="none" />
          {/* 側線 */}
          <line x1={s}     y1={ry} x2={s}     y2={h - ry} stroke={stroke} strokeWidth={sw} />
          <line x1={w - s} y1={ry} x2={w - s} y2={h - ry} stroke={stroke} strokeWidth={sw} />
          {/* 底面境界線 */}
          <path
            d={`M ${s} ${h - ry} Q ${w / 2} ${h - ry + ry * 2} ${w - s} ${h - ry}`}
            fill="none" stroke={stroke} strokeWidth={sw}
          />
          {/* 上面楕円 */}
          <ellipse cx={w / 2} cy={ry} rx={(w - sw) / 2} ry={ry}
            fill={fill} stroke={stroke} strokeWidth={sw} />
        </g>
      );
    }

    case 'rect':
    default:
      return (
        <rect x={s} y={s} width={w - sw} height={h - sw}
          fill={fill} stroke={stroke} strokeWidth={sw} />
      );
  }
}

/**
 * 回転ドラッグハンドル（選択時のみ表示）
 * nodrag クラスで ReactFlow のノードドラッグと競合しないようにする
 */
function RotationHandle({ onMouseDown }) {
  return (
    <div
      className="nodrag"
      onMouseDown={onMouseDown}
      style={{
        position: 'absolute',
        top: -28,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: 'grab',
        zIndex: 20,
        pointerEvents: 'all',
        userSelect: 'none',
      }}
    >
      {/* 接続線 */}
      <div style={{ width: 1, height: 10, background: '#0078d4' }} />
      {/* ハンドル円 */}
      <div style={{
        width: 13,
        height: 13,
        borderRadius: '50%',
        background: '#fff',
        border: '2px solid #0078d4',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 9,
        color: '#0078d4',
      }}>
        ↻
      </div>
    </div>
  );
}

/**
 * ブロック図用カスタムノード
 *
 * data props:
 *   shape       - 'rect' | 'rounded' | 'diamond' | 'ellipse' | 'parallelogram' | 'hexagon' | 'cylinder'
 *   fillColor   - 塗り色
 *   borderColor - 枠線色
 *   borderWidth - 枠線太さ (px)
 *   textColor   - 文字色
 *   fontSize    - フォントサイズ
 *   rotation    - 回転角度 (度, 0-359)
 *   isEdgeSrc   - エッジ追加モードで接続元として選択中
 *   onRotationDragStart - 回転ドラッグ開始コールバック (mouseEvent) => void
 *   onResizeEnd - リサイズ完了コールバック (width, height) => void
 *   width / height - ノードサイズ
 */
export default function ShapeNode({ data, selected, width: rfWidth, height: rfHeight }) {
  const w        = rfWidth  || data.width  || 160;
  const h        = rfHeight || data.height || 60;
  const rotation = data.rotation || 0;
  const sw = selected || data.isEdgeSrc ? 2.5 : (data.borderWidth || 1.5);

  const fill = data.fillColor || '#ffffff';
  const stroke = data.isEdgeSrc
    ? '#f59e0b'            // 接続元: 橙
    : selected
      ? '#0078d4'          // 選択中: 青
      : (data.borderColor || '#888888');

  const glow = data.isEdgeSrc
    ? '0 0 0 3px rgba(245,158,11,0.4)'
    : selected
      ? '0 0 0 3px rgba(0,120,212,0.25)'
      : 'none';

  const handleRotationMouseDown = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    data.onRotationDragStart?.(e);
  }, [data]);

  return (
    <div style={{ width: w, height: h, position: 'relative', overflow: 'visible' }}>
      {/* リサイズハンドル（選択時のみ） */}
      {selected && (
        <NodeResizer
          minWidth={60}
          minHeight={30}
          onResize={(_, { width, height }) => data.onResizeLive?.(width, height)}
          onResizeEnd={(_, { width, height }) => data.onResizeEnd?.(width, height)}
          handleStyle={{
            width: 10, height: 10, borderRadius: '50%',
            background: '#ffffff', border: '2px solid #0078d4',
            zIndex: 20,
          }}
          lineStyle={{ borderColor: '#0078d4', borderWidth: 1, borderStyle: 'dashed' }}
        />
      )}
      {/* 回転ドラッグハンドル（選択時のみ） */}
      {selected && <RotationHandle onMouseDown={handleRotationMouseDown} />}

      {/* 全4辺にソース＆ターゲット両方のハンドルを配置 */}
      {[Position.Top, Position.Right, Position.Bottom, Position.Left].map(pos => (
        <React.Fragment key={pos}>
          {/* 接続開始ハンドル（可視・小） */}
          <Handle
            type="source"
            position={pos}
            id={`${pos}-source`}
            style={{ background: '#0078d4', width: 8, height: 8, zIndex: 10 }}
          />
          {/* 接続受入ハンドル（不可視・大きめ、ドラッグ先として機能） */}
          <Handle
            type="target"
            position={pos}
            id={`${pos}-target`}
            style={{ background: 'transparent', border: 'none', width: 16, height: 16, zIndex: 9 }}
          />
        </React.Fragment>
      ))}

      {/* 回転対象の内側コンテナ（SVG + テキスト） */}
      <div style={{
        position: 'absolute',
        inset: 0,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: 'center center',
        filter: glow !== 'none' ? `drop-shadow(${glow})` : 'none',
      }}>
        {/* SVG 形状 */}
        <svg
          width={w}
          height={h}
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
        >
          {renderShape(data.shape || 'rect', w, h, fill, stroke, sw)}
        </svg>

        {/* テキストラベル */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4px 12px',
            textAlign: 'center',
            fontSize: data.fontSize || 13,
            color: data.textColor || '#111827',
            fontWeight: 500,
            lineHeight: 1.3,
            pointerEvents: 'none',
            wordBreak: 'break-word',
            overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            userSelect: 'none',
          }}
        >
          {data.label}
        </div>
      </div>
    </div>
  );
}
