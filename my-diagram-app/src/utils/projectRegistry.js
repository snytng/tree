/**
 * projectRegistry.js
 * プロジェクト一覧をサーバーで管理し、WebSocketでリアルタイム同期する。
 */

// --- 状態管理 ---
let projectsCache = []; // メモリ上のプロジェクトリストのキャッシュ
const updateListeners = new Set(); // UIに変更を通知するためのリスナー
let isInitialized = false;
let ws = null;
const API_BASE_URL = `http://${window.location.hostname}:1234/api`;
const WS_URL = `ws://${window.location.hostname}:1234/ws-registry`;

export function initProjectRegistry() {
  if (isInitialized) return;

  // 1. サーバーから最新のプロジェクトリストを取得
  fetch(`${API_BASE_URL}/projects`)
    .then(res => res.json())
    .then(data => {
      projectsCache = data;
      isInitialized = true;
      notifyListeners(); // 初期データをUIに通知
    })
    .catch(err => console.error('[Registry] Failed to fetch initial projects:', err));

  // 2. WebSocket接続をセットアップ
  setupWebSocket();
}

function setupWebSocket() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[Registry] WebSocket connected.');
  };

  ws.onmessage = (event) => {
    const processData = (textData) => {
      try {
        const message = JSON.parse(textData);
        if (message.type === 'projects_updated') {
          projectsCache = message.payload;
          notifyListeners(); // UIに変更を通知
        }
      } catch (e) {
        console.error('[Registry] Failed to parse WebSocket message:', e);
      }
    };

    if (event.data instanceof Blob) {
      event.data.text().then(processData);
    } else {
      processData(event.data);
    }
  };

  ws.onclose = () => {
    console.log('[Registry] WebSocket disconnected. Reconnecting in 3s...');
    // 3秒後に再接続を試みる
    setTimeout(setupWebSocket, 3000);
  };

  ws.onerror = (err) => {
    console.error('[Registry] WebSocket error:', err);
    ws.close();
  };
}

function notifyListeners() {
  updateListeners.forEach(listener => listener(projectsCache));
}

/** UIコンポーネントがプロジェクトリストの変更を購読するための関数 */
export function observeProjects(callback) {
  updateListeners.add(callback);
  // 初期化済みであれば、すぐに現在のデータを渡す
  if (isInitialized) {
    callback(projectsCache);
  }
  // 購読解除用の関数を返す
  return () => updateListeners.delete(callback);
}

/** 現在のプロジェクトリストのキャッシュを同期的に取得 */
export function getProjects() {
  return projectsCache;
}

// --- CRUD操作をAPI呼び出しに変更 ---

export async function createProject(name) {
  const response = await fetch(`${API_BASE_URL}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name || '新規プロジェクト' }),
  });
  return response.json();
}

export async function renameProject(id, name) {
  await fetch(`${API_BASE_URL}/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export async function deleteProject(id) {
  await fetch(`${API_BASE_URL}/projects/${id}`, { method: 'DELETE' });
  localStorage.removeItem(`mda_tabs_${id}`);
}

export function findProject(id) {
  return getProjects().find(p => p.id === id) || null;
}

export function destroyProjectRegistry() {
  isInitialized = false;
  updateListeners.clear();
  if (ws) {
    ws.onclose = null; // 再接続を止める
    ws.close();
  }
}

export function syncProjectRegistry() {
  // MCPサーバーとの同期用。現在は何もしない。
}
