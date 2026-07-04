/**
 * ProjectBrowserDialog.jsx
 * プロジェクト一覧の閲覧・切り替え・作成・削除ダイアログ。
 */
import React, { useState, useCallback } from 'react';
import BrowserDialog from './BrowserDialog.jsx';
import * as PS from '../utils/projectStore.js';
import { syncProjectRegistry } from '../utils/projectRegistry.js';

export default function ProjectBrowserDialog({ activeProjectId, onSwitch, onClose }) {
  const [projects, setProjects] = useState(() => PS.getProjects());

  const refresh = () => setProjects(PS.getProjects());

  const handleSelect = useCallback((item) => {
    if (item.id === activeProjectId) { onClose(); return; }
    onSwitch(item.id);
  }, [activeProjectId, onSwitch, onClose]);

  const handleNew = useCallback(async () => {
    console.log('[ProjectBrowser] 「新規作成」ボタンがクリックされました。');
    const name = window.prompt('新しいプロジェクト名を入力してください:', '新規プロジェクト');
    if (!name?.trim()) {
      console.log('[ProjectBrowser] プロジェクト作成がキャンセルされたか、名前が空です。');
      return;
    }
    try {
      console.log(`[ProjectBrowser] projectStore.createProject を呼び出します。名前: "${name.trim()}"`);
      const newProject = await PS.createProject(name.trim());
      console.log('[ProjectBrowser] 新しいプロジェクトが作成されました:', newProject);
      console.log('[ProjectBrowser] onSwitch を呼び出して、新しいプロジェクトに切り替えます。');
      onSwitch(newProject.id);
    } catch (error) {
      console.error('[ProjectBrowser] プロジェクトの作成に失敗しました:', error);
      alert('プロジェクトの作成に失敗しました。コンソールを確認してください。');
    }
  }, [onSwitch]);

  const handleDelete = useCallback((item) => {
    if (item.id === activeProjectId) {
      alert('現在開いているプロジェクトは削除できません。');
      return;
    }
    PS.deleteProject(item.id);
    refresh();
    syncProjectRegistry();
  }, [activeProjectId]);

  const handleRename = useCallback(({ id }, name) => {
    PS.renameProject(id, name);
    refresh();
    syncProjectRegistry();
  }, []);

  return (
    <BrowserDialog
      title="📁 プロジェクト"
      items={projects}
      activeId={activeProjectId}
      onSelect={handleSelect}
      onNew={handleNew}
      newLabel="＋ 新規プロジェクトを作成"
      onDelete={projects.length > 1 ? handleDelete : undefined}
      onRename={handleRename}
      onClose={onClose}
      searchPlaceholder="プロジェクト名で検索…"
      emptyMessage="プロジェクトがありません"
    />
  );
}
