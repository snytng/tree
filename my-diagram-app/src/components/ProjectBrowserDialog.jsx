/**
 * ProjectBrowserDialog.jsx
 * プロジェクト一覧の閲覧・切り替え・作成・削除ダイアログ。
 */
import React, { useState, useCallback, useEffect } from 'react';
import BrowserDialog from './BrowserDialog.jsx';
import { observeProjects, createProject, deleteProject, renameProject } from '../utils/projectRegistry.js';

export default function ProjectBrowserDialog({ activeProjectId, onSwitch, onDelete, onClose }) {
  const [projects, setProjects] = useState([]);

  // projectRegistryからの更新を購読する
  useEffect(() => {
    const unobserve = observeProjects((updatedProjects) => {
      setProjects(updatedProjects);
    });

    // コンポーネントがアンマウントされた時に購読を解除
    return () => unobserve();
  }, []);

  const handleSelect = useCallback((item) => {
    if (item.id === activeProjectId) { onClose(); return; }
    onSwitch(item.id);
  }, [activeProjectId, onSwitch, onClose]);

  const handleNew = useCallback(() => {
    (async () => {
      const name = window.prompt('新しいプロジェクト名を入力してください:', '新規プロジェクト');
      if (name?.trim()) {
        const newProject = await createProject(name.trim());
        // 作成後、すぐにそのプロジェクトに切り替える
        onSwitch(newProject.id);
      }
    })();
  }, []);

  const handleDelete = useCallback((item) => {
    // App.jsxから渡された削除関数を呼び出す
    // 確認ダイアログや画面遷移のロジックはApp.jsx側で一元管理される
    onDelete(item.id);
  }, [onDelete]);

  const handleRename = useCallback(({ id }, name) => {
    // WebSocket経由でリストが更新されるため、ここではAPIを呼ぶだけ
    renameProject(id, name);
  }, []);

  return (
    <BrowserDialog
      title="📁 プロジェクト"
      items={projects}
      activeId={activeProjectId}
      onSelect={handleSelect}
      onNew={handleNew}
      newLabel="＋ 新規プロジェクトを作成"
      // App.jsx側でプロジェクトが0件になる場合の処理が実装されたので、
      // 最後の1件でも削除できるようにする
      onDelete={handleDelete}
      onRename={handleRename}
      onClose={onClose}
      searchPlaceholder="プロジェクト名で検索…"
      emptyMessage="プロジェクトがありません"
    />
  );
}
