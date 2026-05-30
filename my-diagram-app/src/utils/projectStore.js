/**
 * projectStore.js
 * プロジェクト一覧・アクティブプロジェクト・タブ状態を localStorage で管理する。
 */

const PROJ_KEY   = 'mda_projects';
const ACTIVE_KEY = 'mda_active';

function load() {
  try { return JSON.parse(localStorage.getItem(PROJ_KEY) || '[]'); }
  catch { return []; }
}
function save(list) {
  localStorage.setItem(PROJ_KEY, JSON.stringify(list));
}

/** 全プロジェクト一覧を返す */
export function getProjects() { return load(); }

/** 新規プロジェクトを作成して返す */
export function createProject(name) {
  const id = 'proj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  const p  = { id, name: name || '新規プロジェクト', createdAt: new Date().toISOString(), lastModified: new Date().toISOString() };
  save([...load(), p]);
  return p;
}

/** プロジェクト名を変更 */
export function renameProject(id, name) {
  save(load().map(p => p.id === id ? { ...p, name, lastModified: new Date().toISOString() } : p));
}

/** プロジェクトを削除（タブ状態も削除） */
export function deleteProject(id) {
  save(load().filter(p => p.id !== id));
  localStorage.removeItem(`mda_tabs_${id}`);
}

/** 最終更新日時を更新 */
export function touchProject(id) {
  save(load().map(p => p.id === id ? { ...p, lastModified: new Date().toISOString() } : p));
}

/**
 * アクティブプロジェクトIDを返す。
 * - 未設定なら最初のプロジェクトを使用
 * - プロジェクトが1つもなければ初期プロジェクトを作成
 *   (後方互換: 既存データ保持のため room を 'react-flow-demo-room' に固定)
 */
export function getActiveProjectId() {
  const list   = load();
  const stored = localStorage.getItem(ACTIVE_KEY);

  if (stored && list.find(p => p.id === stored)) return stored;

  if (list.length > 0) {
    localStorage.setItem(ACTIVE_KEY, list[0].id);
    return list[0].id;
  }

  // 初回起動: デフォルトプロジェクト作成（既存データ保持のため legacyRoom を保持）
  const id = 'proj_default';
  const p  = {
    id, name: 'マイプロジェクト',
    createdAt: new Date().toISOString(), lastModified: new Date().toISOString(),
    legacyRoom: 'react-flow-demo-room',   // 既存 IndexedDB キーを引き継ぐ
  };
  save([p]);
  localStorage.setItem(ACTIVE_KEY, id);
  return id;
}

/** アクティブプロジェクトIDを設定 */
export function setActiveProjectId(id) {
  localStorage.setItem(ACTIVE_KEY, id);
  touchProject(id);
}

/** プロジェクトの Yjs / WebRTC ルーム名を返す */
export function getRoomName(projectId) {
  const proj = load().find(p => p.id === projectId);
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
