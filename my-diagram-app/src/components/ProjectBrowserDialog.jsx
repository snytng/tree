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

  const handleNew = useCallback(() => {
    const name = window.prompt('新しいプロジェクト名を入力してください:', '新規プロジェクト');
    if (!name?.trim()) return;
    PS.createProject(name.trim());
    refresh();
    syncProjectRegistry();
  }, []);

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
