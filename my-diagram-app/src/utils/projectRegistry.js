/**
 * projectRegistry.js
 * プロジェクト一覧を Yjs レジストリルーム (mda__registry) に公開する。
 * MCP サーバーがこのルームを読み取ることで、プロジェクト ID → ルーム名の
 * マッピングを自動解決できる。
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import * as PS from './projectStore.js';

const REGISTRY_ROOM = 'mda__registry';

let _doc = null;
let _provider = null;
let _synced = false;

export function initProjectRegistry() {
  if (_doc) return;
  _doc = new Y.Doc();
  try {
    _provider = new WebsocketProvider(
      `ws://${window.location.hostname}:1234`, REGISTRY_ROOM, _doc
    );
    _provider.on('sync', (synced) => {
      if (synced) {
        _synced = true;
        syncProjectRegistry();
      }
    });
  } catch {
    _provider = null;
  }
}

/** localStorage のプロジェクト一覧をレジストリに同期する */
export function syncProjectRegistry() {
  if (!_doc || !_synced) return;
  const projects = PS.getProjects();
  const yProjects = _doc.getMap('projects');
  _doc.transact(() => {
    // localStorage から消えたプロジェクトをレジストリからも削除
    for (const key of Array.from(yProjects.keys())) {
      if (!projects.find(p => p.id === key)) yProjects.delete(key);
    }
    // 全プロジェクトを追加/更新
    for (const p of projects) {
      yProjects.set(p.id, {
        name: p.name,
        roomName: PS.getRoomName(p.id),
        createdAt: p.createdAt,
        lastModified: p.lastModified,
      });
    }
  });
}

export function destroyProjectRegistry() {
  try { _provider?.destroy(); } catch {}
  try { _doc?.destroy(); } catch {}
  _doc = null;
  _provider = null;
  _synced = false;
}
