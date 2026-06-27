/**
 * projectStore.js
 * アクティブプロジェクトIDと、プロジェクトごとのタブ状態を localStorage で管理する。
 * プロジェクト自体のCRUDは projectRegistry.js に移譲する。
 */
import * as PR from './projectRegistry.js';

const ACTIVE_KEY = 'mda_active';

export function getActiveProjectId() {
  // projectRegistryが初期化されていればそこから、そうでなければ引数から取得
  const list   = PR.getProjects();
  const stored = localStorage.getItem(ACTIVE_KEY);

  // listが未定義または空の場合は、初期化が完了していない可能性があるため、
  // localStorageに保存されている値を一旦返す。
  if (!list || list.length === 0) {
    // プロジェクトが本当に0件になった場合、古いアクティブIDが残っていると問題なのでクリアする。
    if (list && list.length === 0) {
      localStorage.removeItem(ACTIVE_KEY);
      return null;
    }
    // 初回起動時など、projectRegistryがまだ空の場合でもlocalStorageの値は信頼できるため、一旦返す。
    return stored; 
  }

  if (stored && list.find(p => p.id === stored)) return stored;
  
  if (list.length > 0) {
    localStorage.setItem(ACTIVE_KEY, list[0].id);
    return list[0].id;
  }

  return null;
}

/** アクティブプロジェクトIDを設定 */
export function setActiveProjectId(id) {
  localStorage.setItem(ACTIVE_KEY, id);
}

/** プロジェクトの Yjs / WebRTC ルーム名を返す */
export function getRoomName(projectId) {
  const proj = PR.findProject(projectId);
  if (proj?.legacyRoom) return proj.legacyRoom; // 後方互換
  return `mda_${projectId}`;
}

/** タブ状態を保存 */
export function saveTabs(projectId, tabs, activeTabId) {
  localStorage.setItem(`mda_tabs_${projectId}`, JSON.stringify({ tabs, activeTabId }));
}

/** タブ状態を読み込む（なければ null）*/
export function getTabState(projectId) {
  try { return JSON.parse(localStorage.getItem(`mda_tabs_${projectId}`) || 'null'); }
  catch { return null; }
}

/* ══════════════════════════════════════════════
   projectRegistry.js へのラッパー/プロキシ関数
   App.jsx からは projectStore 経由でアクセスする
══════════════════════════════════════════════ */

export function getProjects() {
  return PR.getProjects();
}
export function deleteProject(id) {
  return PR.deleteProject(id);
}
export function renameProject(id, name) {
  return PR.renameProject(id, name);
}
export function findProject(id) {
  return PR.findProject(id);
}
export function observeProjects(callback) {
  return PR.observeProjects(callback);
}
