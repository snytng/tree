import React, {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';

/* ══════════════════════════════════════════════
   固定列の定義
══════════════════════════════════════════════ */
const FIXED_COLS = [
  { key: 'id',          label: 'ID',     defaultWidth: 180, align: 'left',   mono: true  },
  { key: 'label',       label: 'ラベル', defaultWidth: 200, align: 'left',   mono: false },
  { key: 'nodeClass',   label: 'クラス', defaultWidth: 130, align: 'left',   mono: false },
  { key: 'parentCount', label: '親数',   defaultWidth: 70,  align: 'center', mono: false },
  { key: 'childCount',  label: '子数',   defaultWidth: 70,  align: 'center', mono: false },
];
const BD_COL_DEFAULT_WIDTH = 90;

/* ══════════════════════════════════════════════
   コンテキストメニュー
══════════════════════════════════════════════ */
function ContextMenu({ x, y, inDiagram, onAdd, onRemove, onOpen, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const handleDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handleDown);
    return () => document.removeEventListener('mousedown', handleDown);
  }, [onClose]);

  // 画面端で見切れないよう位置調整
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    let left = x, top = y;
    if (x + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 8;
    if (left < 0) left = 8;
    if (top < 0) top = 8;
    setPos({ left, top });
  }, [x, y]);

  return (
    <div ref={ref} style={{
      position: 'fixed', left: pos.left, top: pos.top, zIndex: 9999,
      background: '#ffffff', border: '1px solid #e5e7eb',
      borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
      minWidth: 190, fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: 13, overflow: 'hidden',
    }}>
      {!inDiagram && (
        <button className="tv-ctx-item" onClick={onAdd}>
          <span style={{ marginRight: 8 }}>＋</span>ブロック図に追加
          <kbd className="tv-ctx-kbd">Space</kbd>
        </button>
      )}
      {inDiagram && (
        <>
          <button className="tv-ctx-item" onClick={onOpen}>
            <span style={{ marginRight: 8 }}>🔍</span>図を開いてフォーカス
          </button>
          <button className="tv-ctx-item" onClick={onRemove}>
            <span style={{ marginRight: 8, color: '#dc2626' }}>✕</span>ブロック図から削除
            <kbd className="tv-ctx-kbd">Del</kbd>
          </button>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   メインコンポーネント
   Props:
     ydoc - Yjs ドキュメントインスタンス
     tabs - 開いているタブの配列 [{id, type, title}]
══════════════════════════════════════════════ */
export default function TableView({ ydoc, tabs = [], onOpenDiagram }) {
  const [rows, setRows]               = useState([]);
  const [sortKey, setSortKey]         = useState('label');
  const [sortDir, setSortDir]         = useState('asc');
  const [colWidths, setColWidths]     = useState(() =>
    Object.fromEntries(FIXED_COLS.map(c => [c.key, c.defaultWidth]))
  );
  const [selected, setSelected]       = useState(null); // { nodeId, bdTabId }
  const [contextMenu, setContextMenu] = useState(null); // { x, y, nodeId, bdTabId }
  const [bdMemberships, setBdMemberships] = useState({});   // { tabId → Set<nodeId> }
  const [selectedBdCol,   setSelectedBdCol]   = useState(null); // BD列ヘッダー選択中 (bdTabId)
  const [selectedRowNode, setSelectedRowNode] = useState(null); // 行選択中 (nodeId)
  const [rowFilter, setRowFilter] = useState(null); // 行フィルタ中のbdTabId
  const [colFilter, setColFilter] = useState(null); // 列フィルタ中のnodeId

  const bdTabs = useMemo(
    () => (tabs || []).filter(t => t.type === 'block-diagram'),
    [tabs]
  );

  /* ─── Yjs: nodes / edges 同期 ─── */
  useEffect(() => {
    if (!ydoc) return;
    const yNodes = ydoc.getMap('nodes');
    const yEdges = ydoc.getMap('edges');
    const sync = () => {
      const nodesArr = Array.from(yNodes.values());
      const edgesArr = Array.from(yEdges.values());
      setRows(nodesArr.map(n => ({
        id:          n.id,
        label:       n.data?.label     || '',
        nodeClass:   n.data?.nodeClass || '',
        parentCount: edgesArr.filter(e => e.target === n.id).length,
        childCount:  edgesArr.filter(e => e.source === n.id).length,
      })));
    };
    sync();
    yNodes.observe(sync);
    yEdges.observe(sync);
    return () => { yNodes.unobserve(sync); yEdges.unobserve(sync); };
  }, [ydoc]);

  /* ─── Yjs: bdLayout 同期（ダイアグラムごと） ─── */
  useEffect(() => {
    if (!ydoc || bdTabs.length === 0) return;
    // 各BDタブの diagramId に対応する Yjs マップを取得
    const mapEntries = bdTabs.map(t => {
      const diagramId = t.diagramId || 'default';
      const mapName   = diagramId === 'default' ? 'bdLayout' : `bdLayout_${diagramId}`;
      return { tabId: t.id, map: ydoc.getMap(mapName) };
    });
    const sync = () => {
      setBdMemberships(() => {
        const next = {};
        mapEntries.forEach(({ tabId, map }) => {
          next[tabId] = new Set(Array.from(map.keys()));
        });
        return next;
      });
    };
    sync();
    mapEntries.forEach(({ map }) => map.observe(sync));
    return () => mapEntries.forEach(({ map }) => map.unobserve(sync));
  }, [ydoc, bdTabs]);

  /* ─── ソート ─── */
  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const av = String(a[sortKey] ?? '');
    const bv = String(b[sortKey] ?? '');
    const cmp = av.localeCompare(bv, 'ja', { numeric: true });
    return sortDir === 'asc' ? cmp : -cmp;
  }), [rows, sortKey, sortDir]);

  /* ─── 列幅リサイズ ─── */
  const resizeState = useRef(null);
  const onResizeMouseDown = useCallback((e, colKey) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[colKey] ?? BD_COL_DEFAULT_WIDTH;
    resizeState.current = { colKey, startX, startW };
    const onMove = (ev) => {
      if (!resizeState.current) return;
      const delta = ev.clientX - resizeState.current.startX;
      const newW  = Math.max(40, resizeState.current.startW + delta);
      setColWidths(prev => ({ ...prev, [resizeState.current.colKey]: newW }));
    };
    const onUp = () => {
      resizeState.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [colWidths]);

  /* ─── ブロック図へのノード追加 / 削除 ─── */
  const addToBlockDiagram = useCallback((nodeId, bdTabId) => {
    if (!ydoc) return;
    const tab = bdTabs.find(t => t.id === bdTabId);
    const diagramId = tab?.diagramId || 'default';
    const mapName   = diagramId === 'default' ? 'bdLayout' : `bdLayout_${diagramId}`;
    const yBdLayout = ydoc.getMap(mapName);
    if (yBdLayout.has(nodeId)) return;
    const existingCount = Array.from(yBdLayout.keys()).length;
    const cols = 5;
    const pos  = {
      x: (existingCount % cols) * 220 + 40,
      y: Math.floor(existingCount / cols) * 150 + 40,
    };
    ydoc.transact(() => {
      yBdLayout.set(nodeId, {
        position: pos, shape: 'rect', fillColor: '#ffffff',
        borderColor: '#888888', borderWidth: 1.5, textColor: '#111827',
        fontSize: 13, width: 160, height: 60,
      });
    }, 'local');
  }, [ydoc, bdTabs]);

  const removeFromBlockDiagram = useCallback((nodeId, bdTabId) => {
    if (!ydoc) return;
    const tab     = bdTabs.find(t => t.id === bdTabId);
    const diagramId = tab?.diagramId || 'default';
    const layoutName = diagramId === 'default' ? 'bdLayout'  : `bdLayout_${diagramId}`;
    const edgeName   = diagramId === 'default' ? 'bdEdges'   : `bdEdges_${diagramId}`;
    const yBdLayout  = ydoc.getMap(layoutName);
    const yBdEdges   = ydoc.getMap(edgeName);
    ydoc.transact(() => {
      yBdLayout.delete(nodeId);
      Array.from(yBdEdges.values()).forEach(e => {
        if (e && (e.source === nodeId || e.target === nodeId)) {
          yBdEdges.delete(e.id);
        }
      });
    }, 'local');
  }, [ydoc, bdTabs]);

  /* ─── セル操作 ─── */
  const handleCellClick = useCallback((e, nodeId, bdTabId) => {
    e.stopPropagation();
    setSelected(prev =>
      prev?.nodeId === nodeId && prev?.bdTabId === bdTabId ? null : { nodeId, bdTabId }
    );
    setContextMenu(null);
  }, []);

  const handleCellRightClick = useCallback((e, nodeId, bdTabId) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected({ nodeId, bdTabId });
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId, bdTabId });
  }, []);

  /* ─── キーボードショートカット ─── */
  useEffect(() => {
    const handler = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      // Ctrl+R: フィルタ適用
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        if (selectedBdCol) {
          setRowFilter(v => v === selectedBdCol ? null : selectedBdCol);
        } else if (selectedRowNode) {
          setColFilter(v => v === selectedRowNode ? null : selectedRowNode);
        }
        return;
      }

      // Escape: フィルタ・選択すべて解除
      if (e.key === 'Escape') {
        setRowFilter(null); setColFilter(null);
        setSelectedBdCol(null); setSelectedRowNode(null);
        setSelected(null); setContextMenu(null);
        return;
      }

      if (!selected) return;
      const { nodeId, bdTabId } = selected;
      const members   = bdMemberships[bdTabId] ?? new Set();
      const inDiagram = members.has(nodeId);
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (inDiagram) removeFromBlockDiagram(nodeId, bdTabId);
        else           addToBlockDiagram(nodeId, bdTabId);
      } else if (e.key === 'Delete') {
        e.preventDefault();
        if (inDiagram) removeFromBlockDiagram(nodeId, bdTabId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected, selectedBdCol, selectedRowNode, bdMemberships, addToBlockDiagram, removeFromBlockDiagram]);

  /* ─── レンダリング ─── */
  const allCols = [
    ...FIXED_COLS,
    ...bdTabs.map(t => ({ key: `bd_${t.id}`, label: t.title, bdTabId: t.id, isBd: true })),
  ];

  // フィルタ適用
  const visibleRows = rowFilter
    ? sorted.filter(row => (bdMemberships[rowFilter] ?? new Set()).has(row.id))
    : sorted;
  const visibleBdTabs = colFilter
    ? bdTabs.filter(t => (bdMemberships[t.id] ?? new Set()).has(colFilter))
    : bdTabs;
  const visibleCols = [
    ...FIXED_COLS,
    ...visibleBdTabs.map(t => ({ key: `bd_${t.id}`, label: t.title, bdTabId: t.id, isBd: true })),
  ];

  const rowFilterLabel = rowFilter ? bdTabs.find(t => t.id === rowFilter)?.title : null;
  const colFilterLabel = colFilter ? (rows.find(r => r.id === colFilter)?.label || colFilter) : null;

  return (
    <div
      style={{
        width: '100%', height: '100%', overflow: 'auto',
        background: '#ffffff',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        fontSize: 13, boxSizing: 'border-box',
      }}
      onClick={() => { setSelected(null); setContextMenu(null); setSelectedBdCol(null); setSelectedRowNode(null); }}
    >
      {/* インラインスタイル */}
      <style>{`
        .tv-ctx-item {
          display: flex; align-items: center; width: 100%;
          padding: 8px 14px; background: transparent; border: none;
          cursor: pointer; text-align: left; font-size: 13px; color: #111827;
          font-family: system-ui, -apple-system, sans-serif; transition: background 0.1s;
        }
        .tv-ctx-item:hover { background: #f3f4f6; }
        .tv-ctx-kbd {
          margin-left: auto; padding: 1px 5px;
          background: #f3f4f6; border: 1px solid #d1d5db;
          border-radius: 4px; font-size: 10px; color: #6b7280;
          font-family: ui-monospace, monospace;
        }
        .tv-resize-handle {
          position: absolute; right: 0; top: 0; bottom: 0;
          width: 5px; cursor: col-resize; z-index: 1;
        }
        .tv-resize-handle:hover, .tv-resize-handle:active { background: #3b82f6; }
        .tv-bd-head-sel { background: #c7d2fe !important; color: #3730a3 !important; }
        .tv-row-head-sel { background: #dbeafe !important; }
        .tv-filter-banner {
          position: sticky; top: 0; z-index: 5;
          display: flex; align-items: center; gap: 8px;
          padding: 5px 14px; font-size: 12px; font-weight: 500;
          background: #fffbeb; border-bottom: 1.5px solid #fcd34d; color: #92400e;
        }
        .tv-filter-chip {
          display: inline-flex; align-items: center; gap: 4px;
          background: #fef3c7; border: 1px solid #fcd34d; border-radius: 99px;
          padding: 1px 8px; font-size: 11px; cursor: pointer;
        }
        .tv-filter-chip:hover { background: #fde68a; }
        .tv-bd-cell {
          cursor: pointer; text-align: center;
          padding: 0; border-bottom: 1px solid #f0f0f0;
          border-right: 1px solid #f0f0f0;
          transition: background 0.1s;
        }
        .tv-bd-cell:hover { background: #eff6ff !important; }
        .tv-bd-cell.sel {
          background: #dbeafe !important;
          outline: 2px solid #3b82f6; outline-offset: -2px;
        }
        .tv-check { font-size: 16px; color: #2563eb; line-height: 1; }
      `}</style>

      {/* フィルタバナー */}
      {(rowFilter || colFilter) && (
        <div className="tv-filter-banner">
          <span>🔍 フィルター中</span>
          {rowFilter && (
            <span className="tv-filter-chip" title="クリックまたはESCで解除"
              onClick={e => { e.stopPropagation(); setRowFilter(null); }}>
              行: {rowFilterLabel} ×
            </span>
          )}
          {colFilter && (
            <span className="tv-filter-chip" title="クリックまたはESCで解除"
              onClick={e => { e.stopPropagation(); setColFilter(null); }}>
              列: {colFilterLabel} ×
            </span>
          )}
          <span style={{ marginLeft: 'auto', opacity: 0.6, fontSize: 11 }}>ESC で解除</span>
        </div>
      )}

      <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: '100%' }}>
        <colgroup>
          {visibleCols.map(col => (
            <col key={col.key} style={{ width: colWidths[col.key] ?? BD_COL_DEFAULT_WIDTH }} />
          ))}
        </colgroup>

        <thead>
          <tr style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            {visibleCols.map(col => (
              <th
                key={col.key}
                onClick={(e) => {
                  e.stopPropagation();
                  if (col.isBd) {
                    setSelectedBdCol(v => v === col.bdTabId ? null : col.bdTabId);
                    setSelectedRowNode(null);
                  } else {
                    handleSort(col.key);
                  }
                }}
                style={{
                  padding: '9px 12px',
                  textAlign: col.isBd ? 'center' : (col.align || 'left'),
                  borderBottom: '2px solid #e4e4e7',
                  borderRight: '1px solid #e4e4e7',
                  userSelect: 'none', whiteSpace: 'nowrap',
                  fontWeight: 600, fontSize: 12, letterSpacing: '0.02em',
                  position: 'relative',
                  background: col.isBd
                    ? (selectedBdCol === col.bdTabId ? '#c7d2fe' : (rowFilter === col.bdTabId ? '#e0e7ff' : '#eef2ff'))
                    : '#f4f4f5',
                  color: col.isBd
                    ? (selectedBdCol === col.bdTabId ? '#3730a3' : '#4338ca')
                    : '#374151',
                  cursor: 'pointer',
                  outline: col.isBd && selectedBdCol === col.bdTabId ? '2px solid #6366f1' : 'none',
                  outlineOffset: -2,
                }}
              >
                {col.label}
                {!col.isBd && sortKey === col.key && (
                  <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.55 }}>
                    {sortDir === 'asc' ? '▲' : '▼'}
                  </span>
                )}
                {col.isBd && selectedBdCol === col.bdTabId && (
                  <span style={{ display: 'block', fontSize: 9, opacity: 0.7, marginTop: 1 }}>Ctrl+R フィルター</span>
                )}
                <span
                  className="tv-resize-handle"
                  onMouseDown={e => onResizeMouseDown(e, col.key)}
                />
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td
                colSpan={allCols.length}
                style={{ padding: '60px', textAlign: 'center', color: '#9ca3af', fontSize: 14 }}
              >
                ノードがありません
              </td>
            </tr>
          ) : (
            visibleRows.map((row, i) => {
              const rowBg   = i % 2 === 0 ? '#ffffff' : '#fafafa';
              const isRowSel = selectedRowNode === row.id;
              return (
                <tr
                  key={row.id}
                  style={{ background: isRowSel ? '#dbeafe' : rowBg }}
                  onMouseEnter={e => { if (!isRowSel) e.currentTarget.style.background = '#f8fafc'; }}
                  onMouseLeave={e => { if (!isRowSel) e.currentTarget.style.background = rowBg; }}
                >
                  <td
                    onClick={e => {
                      e.stopPropagation();
                      setSelectedRowNode(v => v === row.id ? null : row.id);
                      setSelectedBdCol(null);
                    }}
                    style={{
                      padding: '6px 12px', borderBottom: '1px solid #f0f0f0',
                      borderRight: '1px solid #f0f0f0',
                      fontFamily: 'ui-monospace, Consolas, monospace',
                      fontSize: 11, color: isRowSel ? '#1e40af' : '#6b7280',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      cursor: 'pointer', userSelect: 'none',
                      background: isRowSel ? '#dbeafe' : undefined,
                    }}
                  >
                    {isRowSel && <span style={{ marginRight: 4, fontSize: 9 }}>▶</span>}
                    {row.id}
                  </td>

                  <td style={{
                    padding: '6px 12px', borderBottom: '1px solid #f0f0f0',
                    borderRight: '1px solid #f0f0f0',
                    fontWeight: 500, color: '#111827',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{row.label}</td>

                  <td style={{
                    padding: '6px 12px', borderBottom: '1px solid #f0f0f0',
                    borderRight: '1px solid #f0f0f0',
                  }}>
                    {row.nodeClass && (
                      <span style={{
                        background: '#ede9fe', color: '#5b21b6',
                        borderRadius: 4, padding: '2px 7px',
                        fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                      }}>
                        {row.nodeClass}
                      </span>
                    )}
                  </td>

                  <td style={{
                    padding: '6px 12px', borderBottom: '1px solid #f0f0f0',
                    borderRight: '1px solid #f0f0f0', textAlign: 'center', color: '#374151',
                  }}>{row.parentCount}</td>

                  <td style={{
                    padding: '6px 12px', borderBottom: '1px solid #f0f0f0',
                    borderRight: '1px solid #f0f0f0', textAlign: 'center', color: '#374151',
                  }}>{row.childCount}</td>

                  {/* ブロック図交点セル */}
                  {visibleBdTabs.map(t => {
                    const members   = bdMemberships[t.id] ?? new Set();
                    const inDiagram = members.has(row.id);
                    const isSel     = selected?.nodeId === row.id && selected?.bdTabId === t.id;
                    return (
                      <td
                        key={t.id}
                        className={`tv-bd-cell${isSel ? ' sel' : ''}`}
                        title={inDiagram
                          ? 'クリック選択 / Space:削除 / 右クリック:メニュー'
                          : 'クリック選択 / Space:追加 / 右クリック:メニュー'}
                        onClick={e => handleCellClick(e, row.id, t.id)}
                        onContextMenu={e => handleCellRightClick(e, row.id, t.id)}
                      >
                        {inDiagram && <span className="tv-check">✓</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/* コンテキストメニュー */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          inDiagram={(bdMemberships[contextMenu.bdTabId] ?? new Set()).has(contextMenu.nodeId)}
          onAdd={() => { addToBlockDiagram(contextMenu.nodeId, contextMenu.bdTabId); setContextMenu(null); }}
          onRemove={() => { removeFromBlockDiagram(contextMenu.nodeId, contextMenu.bdTabId); setContextMenu(null); }}
          onOpen={() => { onOpenDiagram?.(contextMenu.bdTabId, contextMenu.nodeId); setContextMenu(null); }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
