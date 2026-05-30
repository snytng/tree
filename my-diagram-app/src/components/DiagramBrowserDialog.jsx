/**
 * DiagramBrowserDialog.jsx
 * 現在のプロジェクト内にある複数のブロック図を一覧・開く・作成・削除するダイアログ。
 * Yjs の bdDiagramsMeta マップを参照する。
 */
import React, { useState, useEffect, useCallback } from 'react';
import BrowserDialog from './BrowserDialog.jsx';

export default function DiagramBrowserDialog({ ydoc, openTabDiagramIds = [], onOpen, onNew, onClose }) {
  const [diagrams, setDiagrams] = useState([]);

  // bdDiagramsMeta の変更を購読
  useEffect(() => {
    if (!ydoc) return;
    const yMeta = ydoc.getMap('bdDiagramsMeta');

    const sync = () => {
      const list = Array.from(yMeta.values())
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      setDiagrams(list);
    };

    sync();
    yMeta.observe(sync);
    return () => yMeta.unobserve(sync);
  }, [ydoc]);

  const handleSelect = useCallback((item) => {
    onOpen(item.id, item.name);
  }, [onOpen]);

  const handleNew = useCallback(() => {
    const name = window.prompt('新しいブロック図の名前を入力してください:', '新しいブロック図');
    if (!name?.trim()) return;
    onNew(name.trim());
  }, [onNew]);

  const handleDelete = useCallback((item) => {
    if (!ydoc) return;
    const yMeta = ydoc.getMap('bdDiagramsMeta');
    // ブロック図のノード・エッジデータも削除
    const mapName   = item.id === 'default' ? 'bdLayout'  : `bdLayout_${item.id}`;
    const edgeName  = item.id === 'default' ? 'bdEdges'   : `bdEdges_${item.id}`;
    ydoc.transact(() => {
      yMeta.delete(item.id);
      // レイアウト・エッジはクリアのみ（マップ自体は Yjs 上残る）
      const yLayout = ydoc.getMap(mapName);
      const yEdges  = ydoc.getMap(edgeName);
      Array.from(yLayout.keys()).forEach(k => yLayout.delete(k));
      Array.from(yEdges.keys()).forEach(k => yEdges.delete(k));
    }, 'local');
  }, [ydoc]);

  const handleRename = useCallback(({ id }, name) => {
    if (!ydoc) return;
    const yMeta = ydoc.getMap('bdDiagramsMeta');
    const curr  = yMeta.get(id);
    if (curr) {
      ydoc.transact(() => yMeta.set(id, { ...curr, name }), 'local');
    }
  }, [ydoc]);

  // 現在タブで開いている diagramId を active 表示（複数の可能性あり → 最初の1つ）
  const activeId = openTabDiagramIds[0];

  return (
    <BrowserDialog
      title="🗂 ブロック図"
      items={diagrams}
      activeId={activeId}
      onSelect={handleSelect}
      onNew={handleNew}
      newLabel="＋ 新しいブロック図を作成"
      onDelete={diagrams.length > 1 ? handleDelete : undefined}
      onRename={handleRename}
      onClose={onClose}
      searchPlaceholder="ブロック図名で検索…"
      emptyMessage="ブロック図がまだありません"
    />
  );
}
