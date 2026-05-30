/**
 * BrowserDialog.jsx
 * プロジェクト・ブロック図を一覧表示する汎用モーダルブラウザ。
 *
 * Props:
 *   title          - ダイアログタイトル
 *   items          - { id, name, createdAt, lastModified? }[] の配列
 *   activeId       - 現在アクティブな項目の id（ハイライト用）
 *   onSelect       - (item) => void  クリックで選択
 *   onNew          - () => void  新規作成ボタン
 *   newLabel       - 新規作成ボタンのラベル
 *   onDelete       - (item) => void  削除ボタン（省略時は削除ボタン非表示）
 *   onRename       - (item, newName) => void  ダブルクリックでリネーム（省略時は不可）
 *   onClose        - () => void
 *   searchPlaceholder
 *   emptyMessage
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('ja-JP') + ' ' + d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

export default function BrowserDialog({
  title,
  items = [],
  activeId,
  onSelect,
  onNew,
  newLabel = '＋ 新規作成',
  onDelete,
  onRename,
  onClose,
  searchPlaceholder = '名前で検索…',
  emptyMessage = '項目がありません',
}) {
  const [query, setQuery]         = useState('');
  const [renameId, setRenameId]   = useState(null);
  const [renameVal, setRenameVal] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  const inputRef   = useRef(null);
  const renameRef  = useRef(null);

  // 開いたら検索窓にフォーカス
  useEffect(() => { inputRef.current?.focus(); }, []);

  // ESC で閉じる
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        if (renameId) { setRenameId(null); return; }
        if (confirmId) { setConfirmId(null); return; }
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, renameId, confirmId]);

  const filtered = items.filter(item =>
    item.name.toLowerCase().includes(query.toLowerCase())
  );

  const startRename = useCallback((item, e) => {
    e.stopPropagation();
    if (!onRename) return;
    setRenameId(item.id);
    setRenameVal(item.name);
    setTimeout(() => renameRef.current?.select(), 50);
  }, [onRename]);

  const commitRename = useCallback(() => {
    if (renameId && renameVal.trim()) {
      onRename?.({ id: renameId }, renameVal.trim());
    }
    setRenameId(null);
  }, [renameId, renameVal, onRename]);

  /* ─── スタイル定数 ─── */
  const S = {
    backdrop: {
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    panel: {
      background: '#ffffff', borderRadius: 12,
      width: 500, maxHeight: '72vh',
      boxShadow: '0 24px 64px rgba(0,0,0,0.28)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    },
    header: {
      padding: '14px 18px 10px',
      borderBottom: '1px solid #e5e7eb',
    },
    searchInput: {
      width: '100%', padding: '7px 12px',
      border: '1.5px solid #e5e7eb', borderRadius: 7,
      fontSize: 13, outline: 'none', boxSizing: 'border-box',
      transition: 'border-color 0.15s',
    },
    footer: { padding: '10px 18px', borderTop: '1px solid #e5e7eb' },
    newBtn: {
      width: '100%', padding: '8px',
      background: '#2563eb', color: '#fff',
      border: 'none', borderRadius: 7,
      cursor: 'pointer', fontSize: 13, fontWeight: 500,
      transition: 'background 0.1s',
    },
  };

  return (
    <div style={S.backdrop} onClick={onClose}>
      <div style={S.panel} onClick={e => e.stopPropagation()}>
        {/* ヘッダー */}
        <div style={S.header}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>{title}</span>
            <button
              onClick={onClose}
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: '#9ca3af', lineHeight: 1, padding: '2px 4px' }}
              title="閉じる"
            >✕</button>
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            style={S.searchInput}
            onFocus={e => (e.target.style.borderColor = '#3b82f6')}
            onBlur={e => (e.target.style.borderColor = '#e5e7eb')}
          />
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 5 }}>
            {filtered.length} 件
            {onRename && ' · ダブルクリックで名前変更'}
          </div>
        </div>

        {/* リスト */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '36px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
              {query ? `"${query}" に一致する項目がありません` : emptyMessage}
            </div>
          ) : filtered.map(item => {
            const isActive = item.id === activeId;
            return (
              <div
                key={item.id}
                style={{
                  display: 'flex', alignItems: 'center',
                  padding: '8px 18px', cursor: 'pointer',
                  background: isActive ? '#eff6ff' : 'transparent',
                  borderLeft: isActive ? '3px solid #2563eb' : '3px solid transparent',
                  transition: 'background 0.1s',
                  gap: 10,
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f9fafb'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                onClick={() => onSelect(item)}
                onDoubleClick={e => startRename(item, e)}
              >
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  {renameId === item.id ? (
                    <input
                      ref={renameRef}
                      value={renameVal}
                      onClick={e => e.stopPropagation()}
                      onChange={e => setRenameVal(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') { setRenameId(null); e.stopPropagation(); }
                      }}
                      style={{
                        width: '100%', padding: '2px 6px', fontSize: 13,
                        border: '1.5px solid #3b82f6', borderRadius: 4, outline: 'none',
                      }}
                    />
                  ) : (
                    <>
                      <div style={{ fontSize: 13, fontWeight: isActive ? 600 : 500, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
                        {item.lastModified
                          ? `更新: ${formatDate(item.lastModified)}`
                          : `作成: ${formatDate(item.createdAt)}`}
                      </div>
                    </>
                  )}
                </div>

                {/* 削除ボタン */}
                {onDelete && (
                  confirmId === item.id ? (
                    <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => { onDelete(item); setConfirmId(null); }}
                        style={{ padding: '2px 8px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                      >削除</button>
                      <button
                        onClick={() => setConfirmId(null)}
                        style={{ padding: '2px 8px', background: '#e5e7eb', color: '#374151', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                      >取消</button>
                    </div>
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); setConfirmId(item.id); }}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#d1d5db', fontSize: 14, padding: '4px 6px', borderRadius: 4, transition: 'color 0.1s' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#d1d5db')}
                      title="削除"
                    >🗑</button>
                  )
                )}
              </div>
            );
          })}
        </div>

        {/* フッター */}
        {onNew && (
          <div style={S.footer}>
            <button
              style={S.newBtn}
              onClick={onNew}
              onMouseEnter={e => (e.currentTarget.style.background = '#1d4ed8')}
              onMouseLeave={e => (e.currentTarget.style.background = '#2563eb')}
            >
              {newLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
