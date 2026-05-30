import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import ShapeNode    from './block-diagram/ShapeNode';
import FloatingEdge from './block-diagram/FloatingEdge';
import './BlockDiagramView.css';

/* ══════════════════════════════════════════════
   パレット定数
══════════════════════════════════════════════ */
const FILL_COLORS = [
  '#ffffff','#dbeafe','#dcfce7','#fef9c3',
  '#ffedd5','#fee2e2','#ede9fe','#f3f4f6',
  '#1e40af','#15803d','#b91c1c','#111827',
];

const BORDER_COLORS = [
  '#888888','#111827','#2563eb','#16a34a',
  '#dc2626','#ea580c','#7c3aed','none',
];

const TEXT_COLORS = [
  '#111827','#ffffff','#1e40af','#15803d','#b91c1c','#7c3aed',
];

const BORDER_WIDTHS = [
  { v: 1, label: '細' },
  { v: 2, label: '中' },
  { v: 3, label: '太' },
  { v: 4, label: '極' },
];

const SHAPES = [
  { type: 'rect',          icon: '▭', label: '四角形'    },
  { type: 'rounded',       icon: '▢', label: '角丸四角形' },
  { type: 'diamond',       icon: '◇', label: '菱形'      },
  { type: 'ellipse',       icon: '○', label: '楕円'      },
  { type: 'parallelogram', icon: '▱', label: '平行四辺形' },
  { type: 'hexagon',       icon: '⬡', label: '六角形'    },
  { type: 'cylinder',      icon: '⌀', label: 'シリンダー' },
];

/* ══════════════════════════════════════════════
   ヘルパー
══════════════════════════════════════════════ */
function getDefaultPos(idx) {
  const cols = 5;
  return { x: (idx % cols) * 220 + 40, y: Math.floor(idx / cols) * 150 + 40 };
}

/* ══════════════════════════════════════════════
   色スウォッチ（共通）
══════════════════════════════════════════════ */
function Swatch({ color, current, onSelect }) {
  const isNone = color === 'none';
  return (
    <button
      className={`bd-swatch${current === color ? ' selected' : ''}`}
      title={isNone ? 'なし' : color}
      onClick={() => onSelect(color)}
      style={{
        background: isNone
          ? 'linear-gradient(to bottom right,#fff 46%,#e00 46%,#e00 54%,#fff 54%)'
          : color,
      }}
    />
  );
}

/* ══════════════════════════════════════════════
   スタイルフライアウト（ツールバーボタン押下時に表示）
══════════════════════════════════════════════ */
function StyleFlyout({ menu, nodeData, onUpdate, defaultShape, onDefaultShapeChange }) {
  const cur = menu !== 'newShape' ? Math.round(((nodeData?.rotation || 0) + 360) % 360) : 0;
  const rotateBy = (delta) => onUpdate({ rotation: ((cur + delta) + 360) % 360 });

  const titles = {
    shape: '形状', fill: '塗り色', borderColor: '枠線色',
    borderWidth: '枠線の太さ', textColor: '文字色', rotation: '回転',
    newShape: '追加する形状',
  };

  return (
    <div className="bd-style-flyout">
      <div className="bd-flyout-title">{titles[menu]}</div>

      {/* 追加する形状の選択 */}
      {menu === 'newShape' && (
        <div className="bd-flyout-shapes">
          {SHAPES.map(sh => (
            <button
              key={sh.type}
              className={`bd-flyout-shape-btn${defaultShape === sh.type ? ' selected' : ''}`}
              onClick={() => onDefaultShapeChange(sh.type)}
            >
              <span style={{ fontSize: 16 }}>{sh.icon}</span>
              <span>{sh.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* 選択ノードの形状変更 */}
      {menu === 'shape' && (
        <div className="bd-flyout-shapes">
          {SHAPES.map(sh => (
            <button
              key={sh.type}
              className={`bd-flyout-shape-btn${nodeData.shape === sh.type ? ' selected' : ''}`}
              onClick={() => onUpdate({ shape: sh.type })}
            >
              <span style={{ fontSize: 16 }}>{sh.icon}</span>
              <span>{sh.label}</span>
            </button>
          ))}
        </div>
      )}

      {menu === 'fill' && (
        <div className="bd-flyout-swatches">
          {FILL_COLORS.map(c => (
            <Swatch key={c} color={c} current={nodeData.fillColor} onSelect={v => onUpdate({ fillColor: v })} />
          ))}
        </div>
      )}

      {menu === 'borderColor' && (
        <div className="bd-flyout-swatches">
          {BORDER_COLORS.map(c => (
            <Swatch key={c} color={c} current={nodeData.borderColor} onSelect={v => onUpdate({ borderColor: v })} />
          ))}
        </div>
      )}

      {menu === 'borderWidth' && (
        <div className="bd-flyout-row">
          {BORDER_WIDTHS.map(bw => (
            <button
              key={bw.v}
              className={`bd-width-btn${nodeData.borderWidth === bw.v ? ' selected' : ''}`}
              onClick={() => onUpdate({ borderWidth: bw.v })}
            >
              {bw.label}
            </button>
          ))}
        </div>
      )}

      {menu === 'textColor' && (
        <div className="bd-flyout-swatches">
          {TEXT_COLORS.map(c => (
            <Swatch key={c} color={c} current={nodeData.textColor} onSelect={v => onUpdate({ textColor: v })} />
          ))}
        </div>
      )}

      {menu === 'rotation' && (
        <>
          <div className="bd-flyout-row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {[0, 45, 90, 135, 180, 270].map(a => (
              <button key={a}
                className={`bd-width-btn${cur === a ? ' selected' : ''}`}
                title={`${a}度に設定`}
                onClick={() => onUpdate({ rotation: a })}>
                {a}°
              </button>
            ))}
          </div>
          <div className="bd-flyout-row" style={{ marginTop: 6, gap: 4, alignItems: 'center' }}>
            <button className="bd-width-btn" title="-15度" onClick={() => rotateBy(-15)}>-15°</button>
            <button className="bd-width-btn" title="+15度" onClick={() => rotateBy(+15)}>+15°</button>
            <span style={{ fontSize: 12, color: '#374151', fontWeight: 600 }}>{cur}°</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   ノードピッカーパネル（未追加ノード一覧）
══════════════════════════════════════════════ */
function NodePickerPanel({ availableNodes, onAdd }) {
  return (
    <div className="bd-node-picker">
      <div className="bd-node-picker-title">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" style={{ flexShrink: 0 }}>
          <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/>
        </svg>
        追加可能なノード
      </div>
      {availableNodes.length === 0 ? (
        <div className="bd-node-picker-empty">すべてのノードが図に含まれています</div>
      ) : (
        <ul className="bd-node-picker-list">
          {availableNodes.map(n => (
            <li key={n.id} className="bd-node-picker-item" onClick={() => onAdd(n.id)}>
              <span className="bd-node-picker-label">{n.data?.label || n.id}</span>
              <span className="bd-node-picker-add">＋</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   ツールバーボタン
══════════════════════════════════════════════ */
function TBtn({ active, danger, small, title, onClick, children }) {
  return (
    <button
      className={[
        'bd-toolbar-btn',
        active  ? 'active'  : '',
        danger  ? 'danger'  : '',
        small   ? 'small'   : '',
      ].filter(Boolean).join(' ')}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ══════════════════════════════════════════════
   メインコンポーネント（ReactFlow内側）
══════════════════════════════════════════════ */
function BlockDiagramInner({ ydoc, diagramId = 'default', focusNodeId, onFocusDone }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [isAddMode,      setIsAddMode]      = useState(false);
  const [isEdgeMode,     setIsEdgeMode]     = useState(false);
  const [edgeSrc,        setEdgeSrc]        = useState(null);
  const [defaultShape,   setDefaultShape]   = useState('rect');
  const [rotatingState,  setRotatingState]  = useState(null); // { nodeId, angle }
  const [showNodePicker, setShowNodePicker] = useState(false);
  const [availableNodes, setAvailableNodes] = useState([]);
  const [activeStyleMenu, setActiveStyleMenu] = useState(null);
  const nodesRef = useRef([]);
  const edgesRef = useRef([]);
  const startRotationDragRef = useRef(null);
  const resizeEndRef = useRef(null);
  const resizeLiveRef = useRef(null);
  const { screenToFlowPosition, setCenter, getZoom } = useReactFlow();

  // ── focusNodeId が指定されたら該当ノードを選択して中央に表示 ──
  useEffect(() => {
    if (!focusNodeId) return;
    const tryFocus = () => {
      const node = nodesRef.current.find(n => n.id === focusNodeId);
      if (!node) return false;
      setNodes(nds => nds.map(n => ({ ...n, selected: n.id === focusNodeId })));
      const cx = (node.position?.x || 0) + (node.width || 160) / 2;
      const cy = (node.position?.y || 0) + (node.height || 60) / 2;
      setCenter(cx, cy, { zoom: getZoom(), duration: 400 });
      return true;
    };
    // 即時試行、見つからなければリトライ
    if (!tryFocus()) {
      const timers = [100, 300, 600].map(ms => setTimeout(() => {
        if (tryFocus()) { onFocusDone?.(); timers.forEach(clearTimeout); }
      }, ms));
      // 最終リトライ後にクリア
      setTimeout(() => onFocusDone?.(), 700);
    } else {
      onFocusDone?.();
    }
  }, [focusNodeId]);

  const yNodes    = useMemo(() => ydoc.getMap('nodes'), [ydoc]);
  // diagramId ごとに独立したマップを使用（'default' は後方互換のため旧マップ名を使用）
  const yBdEdges  = useMemo(() =>
    ydoc.getMap(diagramId === 'default' ? 'bdEdges'  : `bdEdges_${diagramId}`),  [ydoc, diagramId]);
  const yBdLayout = useMemo(() =>
    ydoc.getMap(diagramId === 'default' ? 'bdLayout' : `bdLayout_${diagramId}`), [ydoc, diagramId]);

  // bdDiagramsMeta へ登録（未登録の場合のみ）
  useEffect(() => {
    if (!ydoc || !diagramId) return;
    const yBdMeta = ydoc.getMap('bdDiagramsMeta');
    if (!yBdMeta.has(diagramId)) {
      const name = diagramId === 'default' ? 'Block Diagram' : `ブロック図 ${diagramId}`;
      ydoc.transact(() => {
        yBdMeta.set(diagramId, { id: diagramId, name, createdAt: new Date().toISOString() });
      }, 'local');
    }
  }, [ydoc, diagramId]);

  /* ─── Yjs → ReactFlow 同期 ─── */
  useEffect(() => {
    const sync = () => {
      // yBdLayout にエントリがあるノードのみをブロック図に表示（ノードグラフの部分集合）
      const nodesArr = Array.from(yNodes.values()).filter(yn => yn && yBdLayout.has(yn.id));
      const edgesArr = Array.from(yBdEdges.values()).filter(Boolean);

      const rfNodes = nodesArr.map((yn, idx) => {
        const bd = yBdLayout.get(yn.id) || {};
        const w  = bd.width  || 160;
        const h  = bd.height || 60;
        return {
          id:       yn.id,
          type:     'shapeNode',
          position: bd.position || getDefaultPos(idx),
          width:    w,
          height:   h,
          data: {
            label:       yn.data?.label   || '',
            shape:       bd.shape         || 'rect',
            fillColor:   bd.fillColor     || '#ffffff',
            borderColor: bd.borderColor   || '#888888',
            borderWidth: bd.borderWidth   ?? 1.5,
            textColor:   bd.textColor     || '#111827',
            fontSize:    bd.fontSize      || 13,
            rotation:    bd.rotation      || 0,
            isEdgeSrc:   yn.id === edgeSrc,
            width: w,
            height: h,
            onRotationDragStart: (e) => startRotationDragRef.current?.(yn.id, e),
            onResizeLive: (w, h) => resizeLiveRef.current?.(yn.id, w, h),
            onResizeEnd: (w, h) => resizeEndRef.current?.(yn.id, w, h),
          },
          selected: nodesRef.current.find(n => n.id === yn.id)?.selected ?? false,
        };
      });

      const rfEdges = edgesArr.map(e => ({
        id:     e.id,
        type:   'floatingEdge',
        source: e.source,
        target: e.target,
        label:  e.label || '',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#555' },
        style:  { strokeWidth: 1.5, stroke: '#555' },
        selected: edgesRef.current.find(ee => ee.id === e.id)?.selected ?? false,
      }));

      setNodes(rfNodes);
      setEdges(rfEdges);
    };

    sync();
    yNodes.observe(sync);
    yBdEdges.observe(sync);
    yBdLayout.observe(sync);
    return () => {
      yNodes.unobserve(sync);
      yBdEdges.unobserve(sync);
      yBdLayout.unobserve(sync);
    };
  // edgeSrc を依存に入れてエッジソースのハイライトも更新
  }, [ydoc, yNodes, yBdEdges, yBdLayout, edgeSrc]);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  /* ─── 追加可能ノード（yNodes にあり yBdLayout にないもの）を追跡 ─── */
  useEffect(() => {
    const sync = () => {
      const inDiagram = new Set(Array.from(yBdLayout.keys()));
      const all = Array.from(yNodes.values()).filter(Boolean);
      setAvailableNodes(all.filter(n => !inDiagram.has(n.id)));
    };
    sync();
    yNodes.observe(sync);
    yBdLayout.observe(sync);
    return () => {
      yNodes.unobserve(sync);
      yBdLayout.unobserve(sync);
    };
  }, [yNodes, yBdLayout]);

  /* ─── 回転ドラッグ開始 ─── */
  const startRotationDrag = useCallback((nodeId, mouseEvent) => {
    const nodeEl = document.querySelector(`[data-id="${nodeId}"]`);
    if (!nodeEl) return;
    const rect = nodeEl.getBoundingClientRect();
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;

    const calcAngle = (mx, my) => {
      const dx = mx - cx;
      const dy = my - cy;
      // 上方を基点（0°）にするため +90° オフセット
      let deg = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
      return ((deg % 360) + 360) % 360;
    };

    const onMove = (e) => {
      const raw = calcAngle(e.clientX, e.clientY);
      // Shift 押しながらで 15° スナップ
      const angle = e.shiftKey ? Math.round(raw / 15) * 15 : Math.round(raw);
      setRotatingState({ nodeId, angle });
    };

    const onUp = (e) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      const raw   = calcAngle(e.clientX, e.clientY);
      const angle = e.shiftKey
        ? Math.round(raw / 15) * 15
        : Math.round(raw);
      const final = ((angle % 360) + 360) % 360;
      ydoc.transact(() => {
        const bd = yBdLayout.get(nodeId) || {};
        yBdLayout.set(nodeId, { ...bd, rotation: final });
      }, 'local');
      setRotatingState(null);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }, [ydoc, yBdLayout]);

  // ref を常に最新の startRotationDrag に同期
  startRotationDragRef.current = startRotationDrag;

  /* ─── 回転中のアングルを nodes state に後次適用 ─── */
  useEffect(() => {
    if (!rotatingState) return;
    setNodes(prev => prev.map(n =>
      n.id === rotatingState.nodeId
        ? { ...n, data: { ...n.data, rotation: rotatingState.angle } }
        : n
    ));
  }, [rotatingState, setNodes]);

  /* ─── ドラッグ停止 → bdLayout に位置を保存 ─── */
  const onNodeDragStop = useCallback((_, node) => {
    ydoc.transact(() => {
      const bd = yBdLayout.get(node.id) || {};
      yBdLayout.set(node.id, { ...bd, position: node.position });
    }, 'local');
  }, [ydoc, yBdLayout]);

  /* ─── キャンバスクリック → ノード追加 ─── */
  const onPaneClick = useCallback((event) => {
    if (isAddMode) {
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const id  = `node-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      ydoc.transact(() => {
        yNodes.set(id, {
          id, type: 'custom', position: pos,
          data: { label: 'New Node' },
          width: 160, height: 60,
        });
        yBdLayout.set(id, {
          position: pos,
          shape: defaultShape,
          fillColor: '#ffffff',
          borderColor: '#888888',
          borderWidth: 1.5,
          textColor: '#111827',
          fontSize: 13,
          width: 160,
          height: 60,
        });
      }, 'local');
      setIsAddMode(false);
    } else if (isEdgeMode && edgeSrc) {
      // 背景クリックでエッジモードをキャンセル
      setEdgeSrc(null);
    }
  }, [isAddMode, isEdgeMode, edgeSrc, defaultShape, screenToFlowPosition, ydoc, yNodes, yBdLayout]);

  /* ─── ノードクリック → エッジ接続 ─── */
  const onNodeClick = useCallback((event, node) => {
    if (!isEdgeMode) return;
    event.stopPropagation();
    if (!edgeSrc) {
      setEdgeSrc(node.id);
    } else if (edgeSrc !== node.id) {
      const edgeId = `edge-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      ydoc.transact(() => {
        yBdEdges.set(edgeId, { id: edgeId, source: edgeSrc, target: node.id });
      }, 'local');
      setEdgeSrc(null);
      setIsEdgeMode(false);
    }
  }, [isEdgeMode, edgeSrc, ydoc, yBdEdges]);

  /* ─── ハンドル接続（ドラッグ） ─── */
  const onConnect = useCallback((params) => {
    const edgeId = `edge-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    ydoc.transact(() => {
      yBdEdges.set(edgeId, { id: edgeId, source: params.source, target: params.target });
    }, 'local');
  }, [ydoc, yBdEdges]);

  /* ─── 既存ノードをブロック図に追加 ─── */
  const onAddExistingNode = useCallback((nodeId) => {
    const yn = yNodes.get(nodeId);
    if (!yn || yBdLayout.has(nodeId)) return;
    const existingCount = Array.from(yBdLayout.keys()).length;
    const pos = getDefaultPos(existingCount);
    ydoc.transact(() => {
      yBdLayout.set(nodeId, {
        position: pos,
        shape: defaultShape,
        fillColor: '#ffffff',
        borderColor: '#888888',
        borderWidth: 1.5,
        textColor: '#111827',
        fontSize: 13,
        width: 160,
        height: 60,
      });
    }, 'local');
  }, [ydoc, yNodes, yBdLayout, defaultShape]);

  /* ─── スタイルフライアウトのトグル ─── */
  const toggleStyleMenu = useCallback((menu) => {
    setActiveStyleMenu(v => v === menu ? null : menu);
    setShowNodePicker(false);
  }, []);

  /* ─── リサイズ中（ドラッグ追従）→ React state をリアルタイム更新 ─── */
  const onNodeResizeLive = useCallback((nodeId, w, h) => {
    setNodes(prev => prev.map(n =>
      n.id === nodeId
        ? { ...n, width: w, height: h, data: { ...n.data, width: w, height: h } }
        : n
    ));
  }, [setNodes]);

  resizeLiveRef.current = onNodeResizeLive;

  /* ─── リサイズ終了 → bdLayout にサイズを保存 ─── */
  const onNodeResizeEnd = useCallback((nodeId, w, h) => {
    ydoc.transact(() => {
      const bd = yBdLayout.get(nodeId) || {};
      yBdLayout.set(nodeId, { ...bd, width: w, height: h });
    }, 'local');
  }, [ydoc, yBdLayout]);

  resizeEndRef.current = onNodeResizeEnd;

  /* ─── 選択ノードを削除 ─── */
  const onDelete = useCallback(() => {
    const selNodeIds = new Set(nodesRef.current.filter(n => n.selected).map(n => n.id));
    const selEdgeIds = new Set(edgesRef.current.filter(e => e.selected).map(e => e.id));
    ydoc.transact(() => {
      // ブロック図からノードを削除（yNodes からは削除しない — ノードグラフには残す）
      selNodeIds.forEach(id => { yBdLayout.delete(id); });
      // そのノードに接続されたブロック図エッジも削除
      Array.from(yBdEdges.values()).forEach(e => {
        if (e && (selEdgeIds.has(e.id) || selNodeIds.has(e.source) || selNodeIds.has(e.target))) {
          yBdEdges.delete(e.id);
        }
      });
    }, 'local');
  }, [ydoc, yBdEdges, yBdLayout]);

  /* ─── 選択ノードのスタイルを更新 ─── */
  const onUpdateStyle = useCallback((props) => {
    const selIds = nodesRef.current.filter(n => n.selected).map(n => n.id);
    if (!selIds.length) return;
    ydoc.transact(() => {
      selIds.forEach(id => {
        const bd = yBdLayout.get(id) || {};
        yBdLayout.set(id, { ...bd, ...props });
      });
    }, 'local');
  }, [ydoc, yBdLayout]);

  /* ─── キーボードショートカット ─── */
  useEffect(() => {
    const handler = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'Delete') onDelete();
      if (e.key === 'Escape') {
        setIsAddMode(false);
        setIsEdgeMode(false);
        setEdgeSrc(null);
        setActiveStyleMenu(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onDelete]);

  const nodeTypes = useMemo(() => ({ shapeNode: ShapeNode }), []);
  const edgeTypes = useMemo(() => ({ floatingEdge: FloatingEdge }), []);
  const selectedNode = nodes.find(n => n.selected);

  return (
    <div className="bd-wrapper">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode="loose"
        connectionRadius={50}
        fitView
        zoomOnDoubleClick={false}
        panOnDrag={[1, 2]}
        selectionOnDrag
        style={{ cursor: isAddMode ? 'crosshair' : 'default' }}
      >
        <Background variant="dots" gap={20} size={1} color="#e5e7eb" />
        <Controls />


        {/* エッジ接続元選択中のヒント */}
        {edgeSrc && (
          <Panel position="bottom-center">
            <div style={{
              background: 'rgba(245,158,11,0.9)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              padding: '6px 18px',
              borderRadius: 20,
              fontFamily: 'system-ui, sans-serif',
              pointerEvents: 'none',
            }}>
              接続先のノードをクリック（Esc でキャンセル）
            </div>
          </Panel>
        )}
      </ReactFlow>

      {/* ── 左ツールバー ── */}
      <div className="bd-toolbar">
        {/* ノード一覧パネル表示 */}
        <TBtn active={showNodePicker} title="プロジェクトのノードを追加"
          onClick={() => { setShowNodePicker(v => !v); setActiveStyleMenu(null); }}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/>
          </svg>
        </TBtn>

        <div className="bd-toolbar-sep" />

        {/* ノード追加 */}
        <TBtn active={isAddMode} title="ノードを追加（キャンバスをクリックして配置）"
          onClick={() => { setIsAddMode(v => !v); setIsEdgeMode(false); setEdgeSrc(null); }}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
        </TBtn>

        {/* エッジ追加（2クリック） */}
        <TBtn active={isEdgeMode} title={edgeSrc ? '接続先をクリック（Esc でキャンセル）' : 'エッジを追加'}
          onClick={() => { setIsEdgeMode(v => !v); setIsAddMode(false); setEdgeSrc(null); }}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M13 7v3H5v4h8v3l5-5-5-5z"/>
          </svg>
        </TBtn>

        {/* 削除 */}
        <TBtn title="選択要素を削除（Del）" danger
          onClick={onDelete}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </TBtn>

        {/* ── 選択ノードスタイル（ノード選択中のみ表示） ── */}
        {selectedNode && (
          <>
            <div className="bd-toolbar-sep" />
            <div className="bd-toolbar-label">スタイル</div>

            {/* 形状 */}
            <TBtn small active={activeStyleMenu === 'shape'} title="形状を変更"
              onClick={() => toggleStyleMenu('shape')}>
              <span style={{ fontSize: 16, lineHeight: 1 }}>
                {SHAPES.find(s => s.type === selectedNode.data.shape)?.icon || '▭'}
              </span>
            </TBtn>

            {/* 塗り色 */}
            <TBtn small active={activeStyleMenu === 'fill'} title="塗り色"
              onClick={() => toggleStyleMenu('fill')}>
              <span style={{
                width: 16, height: 16, borderRadius: 3, display: 'block',
                background: selectedNode.data.fillColor || '#ffffff',
                border: '1.5px solid #d1d5db', flexShrink: 0,
              }} />
            </TBtn>

            {/* 枠線色 */}
            <TBtn small active={activeStyleMenu === 'borderColor'} title="枠線色"
              onClick={() => toggleStyleMenu('borderColor')}>
              <span style={{
                width: 16, height: 16, borderRadius: 3, display: 'block',
                background: selectedNode.data.borderColor === 'none'
                  ? 'linear-gradient(to bottom right,#fff 46%,#e00 46%,#e00 54%,#fff 54%)'
                  : (selectedNode.data.borderColor || '#888888'),
                border: '1.5px solid #d1d5db', flexShrink: 0,
              }} />
            </TBtn>

            {/* 枠線太さ */}
            <TBtn small active={activeStyleMenu === 'borderWidth'} title="枠線の太さ"
              onClick={() => toggleStyleMenu('borderWidth')}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <rect x="2" y="11" width="20" height="2" rx="1"/>
              </svg>
            </TBtn>

            {/* 文字色 */}
            <TBtn small active={activeStyleMenu === 'textColor'} title="文字色"
              onClick={() => toggleStyleMenu('textColor')}>
              <span style={{ fontSize: 14, fontWeight: 700, color: selectedNode.data.textColor || '#111827', lineHeight: 1 }}>A</span>
            </TBtn>

            {/* 回転 */}
            <TBtn small active={activeStyleMenu === 'rotation'} title="回転"
              onClick={() => toggleStyleMenu('rotation')}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8A5.87 5.87 0 0 1 6 12c0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z"/>
              </svg>
            </TBtn>
          </>
        )}

        <div className="bd-toolbar-sep" />

        {/* デフォルト形状（1ボタン+フライアウト） */}
        <TBtn small active={activeStyleMenu === 'newShape'} title="追加する形状を選択"
          onClick={() => toggleStyleMenu('newShape')}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>
            {SHAPES.find(s => s.type === defaultShape)?.icon || '▭'}
          </span>
        </TBtn>
      </div>

      {/* ── ノードピッカーパネル ── */}
      {showNodePicker && (
        <NodePickerPanel
          availableNodes={availableNodes}
          onAdd={(id) => { onAddExistingNode(id); }}
        />
      )}

      {/* ── スタイルフライアウト ── */}
      {activeStyleMenu && (selectedNode || activeStyleMenu === 'newShape') && (
        <StyleFlyout
          menu={activeStyleMenu}
          nodeData={selectedNode?.data}
          onUpdate={onUpdateStyle}
          defaultShape={defaultShape}
          onDefaultShapeChange={(shape) => { setDefaultShape(shape); }}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   公開コンポーネント（ReactFlowProvider ラッパー）
══════════════════════════════════════════════ */
export default function BlockDiagramView({ ydoc, diagramId = 'default', focusNodeId, onFocusDone }) {
  return (
    <ReactFlowProvider>
      <BlockDiagramInner ydoc={ydoc} diagramId={diagramId} focusNodeId={focusNodeId} onFocusDone={onFocusDone} />
    </ReactFlowProvider>
  );
}
