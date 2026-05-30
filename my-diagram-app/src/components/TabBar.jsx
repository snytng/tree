import React, { useState, useRef, useEffect, useCallback } from 'react';
import './TabBar.css';

/**
 * 利用可能なビュータイプの定義
 * 新しいビューを追加するときはここにエントリを追加する
 */
export const VIEW_TYPES = [
  {
    type: 'node-graph',
    title: 'ノードグラフ',
    description: '階層ノードグラフ (ReactFlow)',
    singleton: true, // このビューは1つしか開けない
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z" />
      </svg>
    ),
  },
  {
    type: 'table',
    title: '一覧表',
    description: 'Excel風スプレッドシート',
    singleton: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 3h18v18H3V3zm16 16V5H5v14h14zm-8-2H7v-2h4v2zm0-4H7v-2h4v2zm0-4H7V7h4v2zm6 8h-4v-2h4v2zm0-4h-4v-2h4v2zm0-4h-4V7h4v2z" />
      </svg>
    ),
  },
  {
    type: 'block-diagram',
    title: 'Block Diagram',
    description: 'ブロック図',
    singleton: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 17h4v-4H7v4zm6 0h4v-4h-4v4zm-6-6h4V7H7v4zm6 0h4V7h-4v4z" />
      </svg>
    ),
  },
  {
    type: 'function-flow',
    title: 'Function Flow',
    description: 'ファンクションフロー図',
    singleton: false,
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L13.67 12l-3.58 3.59zM7 6c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H9c-1.1 0-2-.9-2-2V6z" />
      </svg>
    ),
  },
];

/**
 * VS Code 風タブバーコンポーネント
 */
export default function TabBar({ tabs, activeTabId, onTabChange, onTabClose, onTabRename, onReorder, onCloseOthers, onCloseAll, projectName, onProjectNameChange }) {
  const [editingTabId, setEditingTabId] = useState(null);
  const [editValue, setEditValue]       = useState('');
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const projectNameRef = useRef(null);
  const editRef  = useRef(null);

  // ── ドラッグ並び替え ──
  const [dragTabId, setDragTabId]   = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // { id, side: 'left'|'right' }

  const handleDragStart = useCallback((e, tabId) => {
    setDragTabId(tabId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
  }, []);

  const handleDragOver = useCallback((e, tabId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (tabId === dragTabId) { setDropTarget(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const side = (e.clientX - rect.left) < rect.width / 2 ? 'left' : 'right';
    setDropTarget({ id: tabId, side });
  }, [dragTabId]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    if (!dragTabId || !dropTarget || dragTabId === dropTarget.id) {
      setDragTabId(null); setDropTarget(null); return;
    }
    onReorder?.(dragTabId, dropTarget.id, dropTarget.side);
    setDragTabId(null); setDropTarget(null);
  }, [dragTabId, dropTarget, onReorder]);

  const handleDragEnd = useCallback(() => {
    setDragTabId(null); setDropTarget(null);
  }, []);

  // ── タブ右クリックメニュー ──
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, tabId }
  const ctxRef = useRef(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target)) setCtxMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ctxMenu]);

  return (
    <div className="tab-bar">
      {/* プロジェクト名タブ（固定・一番左） */}
      {projectName !== undefined && (
        <div
          className="tab tab-project-name"
          onDoubleClick={() => {
            setEditingProjectName(true);
            setProjectNameDraft(projectName);
            setTimeout(() => projectNameRef.current?.select(), 30);
          }}
          title="ダブルクリックでプロジェクト名を変更"
        >
          <span className="tab-icon">
            <svg viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.5 1A1.5 1.5 0 000 2.5v11A1.5 1.5 0 001.5 15h13a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0014.5 3H7.71l-1.6-1.6A1.5 1.5 0 005.05 1H1.5z"/>
            </svg>
          </span>
          {editingProjectName ? (
            <input
              ref={projectNameRef}
              className="tab-rename-input"
              value={projectNameDraft}
              onChange={e => setProjectNameDraft(e.target.value)}
              onBlur={() => {
                if (projectNameDraft.trim()) onProjectNameChange?.(projectNameDraft.trim());
                setEditingProjectName(false);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  if (projectNameDraft.trim()) onProjectNameChange?.(projectNameDraft.trim());
                  setEditingProjectName(false);
                }
                if (e.key === 'Escape') setEditingProjectName(false);
                e.stopPropagation();
              }}
              onClick={e => e.stopPropagation()}
              onDoubleClick={e => e.stopPropagation()}
            />
          ) : (
            <span className="tab-title">{projectName}</span>
          )}
        </div>
      )}

      {/* タブリスト */}
      <div className="tab-list" onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
        {tabs.map((tab) => {
          const viewType = VIEW_TYPES.find((vt) => vt.type === tab.type);
          const isActive = tab.id === activeTabId;
          const isDrag   = tab.id === dragTabId;
          const dropSide = dropTarget?.id === tab.id ? dropTarget.side : null;
          return (
            <div
              key={tab.id}
              className={`tab${isActive ? ' tab-active' : ''}${isDrag ? ' tab-dragging' : ''}`}
              style={{
                borderLeft:  dropSide === 'left'  ? '2px solid #0078d4' : undefined,
                borderRight: dropSide === 'right' ? '2px solid #0078d4' : undefined,
              }}
              draggable={editingTabId !== tab.id}
              onDragStart={e => handleDragStart(e, tab.id)}
              onDragOver={e => handleDragOver(e, tab.id)}
              onDragEnd={handleDragEnd}
              onClick={() => onTabChange(tab.id)}
              onDoubleClick={() => {
                if (onTabRename) {
                  setEditingTabId(tab.id);
                  setEditValue(tab.title);
                  setTimeout(() => editRef.current?.select(), 30);
                }
              }}
              onContextMenu={e => {
                e.preventDefault();
                setCtxMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
              }}
              title={tab.title}
            >
              <span className="tab-icon">{viewType?.icon}</span>
              {editingTabId === tab.id ? (
                <input
                  ref={editRef}
                  className="tab-rename-input"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={() => {
                    if (editValue.trim()) onTabRename(tab.id, editValue.trim());
                    setEditingTabId(null);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      if (editValue.trim()) onTabRename(tab.id, editValue.trim());
                      setEditingTabId(null);
                    }
                    if (e.key === 'Escape') setEditingTabId(null);
                    e.stopPropagation();
                  }}
                  onClick={e => e.stopPropagation()}
                  onDoubleClick={e => e.stopPropagation()}
                />
              ) : (
                <span className="tab-title">{tab.title}</span>
              )}
              {tabs.length > 1 && (
                <button
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTabClose(tab.id);
                  }}
                  title="閉じる"
                  aria-label="タブを閉じる"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* タブ右クリックメニュー */}
      {ctxMenu && (
        <div ref={ctxRef} className="tab-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <button className="tab-ctx-item" onClick={() => { onTabClose(ctxMenu.tabId); setCtxMenu(null); }}>
            閉じる
          </button>
          {tabs.length > 1 && (
            <button className="tab-ctx-item" onClick={() => { onCloseOthers?.(ctxMenu.tabId); setCtxMenu(null); }}>
              これ以外を閉じる
            </button>
          )}
          {tabs.length > 1 && (
            <button className="tab-ctx-item" onClick={() => { onCloseAll?.(); setCtxMenu(null); }}>
              すべて閉じる
            </button>
          )}
        </div>
      )}
    </div>
  );
}
