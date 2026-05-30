const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const express = require("express");
const cors = require("cors");
const Y = require('yjs');
const { WebsocketProvider } = require('y-websocket');
const ws = require('ws');

// ============================================================
// Yjs Connection Manager (D-058)
// プロジェクトごとに動的にYjsルームへ接続を切り替える
// ============================================================
let _currentProjectId = null;
let _ydoc = null;
let _wsProvider = null;

let _currentRoomName = null;

function connectToProject(projectId, roomName) {
  // 既存接続を破棄
  if (_wsProvider) {
    _wsProvider.destroy();
    _wsProvider = null;
  }
  if (_ydoc) {
    _ydoc.destroy();
    _ydoc = null;
  }

  if (!projectId) {
    _currentProjectId = null;
    _currentRoomName = null;
    console.log('[Yjs] Disconnected (no project)');
    return Promise.resolve();
  }

  const actualRoom = roomName || `mda_${projectId}`;
  _ydoc = new Y.Doc();
  _wsProvider = new WebsocketProvider('ws://localhost:1234', actualRoom, _ydoc, { WebSocketPolyfill: ws });
  _currentProjectId = projectId;
  _currentRoomName = actualRoom;
  console.log(`[Yjs] Connected to project: ${projectId} (room: ${actualRoom})`);

  // WebSocket同期完了を待つ (最大3秒)
  return new Promise((resolve) => {
    if (_wsProvider.synced) {
      console.log('[Yjs] Already synced');
      return resolve();
    }
    const timer = setTimeout(() => {
      console.log('[Yjs] Sync timeout (3s) - proceeding anyway');
      resolve();
    }, 3000);
    _wsProvider.once('sync', () => {
      clearTimeout(timer);
      console.log('[Yjs] Sync complete');
      resolve();
    });
  });
}

function ensureConnected() {
  if (!_ydoc || !_currentProjectId) {
    throw new Error('プロジェクトに接続されていません。先に switch_project を実行してください。');
  }
}

function getYMaps() {
  ensureConnected();
  return {
    yNodes: _ydoc.getMap('nodes'),
    yEdges: _ydoc.getMap('edges'),
    yProjectMeta: _ydoc.getMap('projectMeta'),
    yBdMeta: _ydoc.getMap('bdDiagramsMeta'),
  };
}

function getBdMaps(diagramId) {
  ensureConnected();
  const layoutName = diagramId === 'default' ? 'bdLayout' : `bdLayout_${diagramId}`;
  const edgesName = diagramId === 'default' ? 'bdEdges' : `bdEdges_${diagramId}`;
  return {
    yBdLayout: _ydoc.getMap(layoutName),
    yBdEdges: _ydoc.getMap(edgesName),
  };
}

// 起動時: 環境変数があればデフォルト接続、なければ未接続
const defaultProjectId = process.env.DEFAULT_PROJECT_ID || null;
if (defaultProjectId) {
  connectToProject(defaultProjectId);
}

// ============================================================
// Project Registry (プロジェクト一覧の自動検出)
// フロントエンドが mda__registry ルームに書き込んだ
// プロジェクト一覧を読み取る
// ============================================================
let _registryDoc = null;
let _registryProvider = null;
let _registrySynced = false;

function initRegistry() {
  _registryDoc = new Y.Doc();
  _registryProvider = new WebsocketProvider(
    'ws://localhost:1234', 'mda__registry', _registryDoc, { WebSocketPolyfill: ws }
  );
  _registryProvider.on('sync', (synced) => {
    if (synced) {
      _registrySynced = true;
      const yProjects = _registryDoc.getMap('projects');
      console.log(`[Registry] Synced - ${yProjects.size} project(s) found`);
    }
  });
}

function getRegistryProjects() {
  if (!_registryDoc || !_registrySynced) return [];
  const yProjects = _registryDoc.getMap('projects');
  const projects = [];
  for (const [id, data] of yProjects.entries()) {
    projects.push({ id, ...data });
  }
  return projects;
}

function resolveRoomName(projectId) {
  const projects = getRegistryProjects();
  const proj = projects.find(p => p.id === projectId);
  return proj?.roomName || `mda_${projectId}`;
}

initRegistry();

// ============================================================
// MCP Server
// ============================================================
async function main() {
  const app = express();
  app.use(cors());

  // 【重要】express.json() は削除またはコメントアウトしてください。
  // MCP SDKの SSEServerTransport が内部でリクエストストリームを直接読み取るため、
  // ここでパースしてしまうと通信が失敗します。

  const activeTransports = new Map();

  app.get("/sse", async (req, res) => {
    console.log(`[SSE] New connection request from ${req.ip}`);
    const server = new Server(
      { name: "diagram-app-mcp", version: "2.0.0" },
      { capabilities: { tools: {} } }
    );

    // ====== ツール定義 ======
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // --- プロジェクト管理 (D-058) ---
        {
          name: "list_projects",
          description: "フロントエンドに登録されたプロジェクト一覧を取得します。各プロジェクトのIDとroomNameを含みます。switch_projectの前に呼んでください。",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "switch_project",
          description: "Yjsルームを指定プロジェクトに切り替えます。ルーム名はレジストリから自動解決されます。roomNameを明示的に指定することもできます。",
          inputSchema: {
            type: "object",
            properties: {
              projectId: { type: "string", description: "プロジェクトID（例: proj_default）。list_projectsで取得したIDを使用" },
              roomName: { type: "string", description: "Yjsルーム名。省略時はレジストリから自動解決" }
            },
            required: ["projectId"]
          }
        },
        {
          name: "current_project",
          description: "現在接続中のプロジェクト情報を返します",
          inputSchema: { type: "object", properties: {} }
        },
        // --- ノードグラフ操作 (既存) ---
        {
          name: "read_graph",
          description: "現在のプロジェクトの全ノードとエッジを取得します",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "add_node",
          description: "ノードグラフに新しいノードを追加します",
          inputSchema: {
            type: "object",
            properties: {
              label: { type: "string", description: "ノードのラベル（例: [S-001] 概要）" },
              id: { type: "string", description: "任意のID（指定しない場合は自動生成）" },
              nodeClass: { type: "string", description: "クラス名 (Requirement, Spec, Design, Issue, DB, Process)" }
            },
            required: ["label"]
          }
        },
        {
          name: "connect_nodes",
          description: "ノードグラフで2つのノード間にエッジを作成します",
          inputSchema: {
            type: "object",
            properties: {
              source: { type: "string", description: "接続元ノードのID" },
              target: { type: "string", description: "接続先ノードのID" }
            },
            required: ["source", "target"]
          }
        },
        {
          name: "update_node",
          description: "既存のノードのラベルやクラスを更新します",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "更新対象ノードのID" },
              label: { type: "string", description: "新しいラベル（省略可）" },
              nodeClass: { type: "string", description: "新しいクラス名 (Requirement, Spec, Design, Issue, DB, Process)（省略可）" }
            },
            required: ["id"]
          }
        },
        {
          name: "delete_node",
          description: "指定したIDのノードと、それに付随するエッジを削除します",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "削除するノードのID" }
            },
            required: ["id"]
          }
        },
        // --- ブロック図操作 (D-059) ---
        {
          name: "list_diagrams",
          description: "現在のプロジェクト内のブロック図一覧を取得します",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "read_diagram",
          description: "指定したブロック図のレイアウト付きノードとエッジを取得します",
          inputSchema: {
            type: "object",
            properties: {
              diagramId: { type: "string", description: "ブロック図ID（例: default）" }
            },
            required: ["diagramId"]
          }
        },
        {
          name: "add_node_to_diagram",
          description: "ブロック図にノードを配置します。nodeIdを指定すると既存ノードを配置、省略すると新規ノードを作成して配置します",
          inputSchema: {
            type: "object",
            properties: {
              diagramId: { type: "string", description: "ブロック図ID" },
              nodeId: { type: "string", description: "既存ノードのID（省略時は新規作成）" },
              label: { type: "string", description: "新規ノードのラベル（nodeId省略時に必須）" },
              nodeClass: { type: "string", description: "新規ノードのクラス名（省略可）" },
              position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, description: "配置位置（省略時は {x:0, y:0}）" },
              shape: { type: "string", description: "図形 (rect, rounded, diamond, ellipse, parallelogram, hexagon, cylinder)（省略時は rect）" }
            },
            required: ["diagramId"]
          }
        },
        {
          name: "add_edge_to_diagram",
          description: "ブロック図にエッジを追加します",
          inputSchema: {
            type: "object",
            properties: {
              diagramId: { type: "string", description: "ブロック図ID" },
              source: { type: "string", description: "接続元ノードのID" },
              target: { type: "string", description: "接続先ノードのID" },
              label: { type: "string", description: "エッジのラベル（省略可）" }
            },
            required: ["diagramId", "source", "target"]
          }
        },
        // --- プロジェクト名操作 (D-059) ---
        {
          name: "get_project_name",
          description: "現在のプロジェクト名を取得します",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "update_project_name",
          description: "プロジェクト名を更新します（Yjs経由でフロントエンドにリアルタイム反映）",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "新しいプロジェクト名" }
            },
            required: ["name"]
          }
        }
      ]
    }));

    // ====== ツール実行ハンドラ ======
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      console.log(`[Tool Call] ${name}`, args);

      switch (name) {
        // --- プロジェクト管理 ---
        case "list_projects": {
          const projects = getRegistryProjects();
          if (projects.length === 0) {
            return { content: [{ type: "text", text: JSON.stringify({
              projects: [],
              hint: 'プロジェクトが見つかりません。フロントエンドが起動中か確認してください。レジストリ同期はフロントエンド起動時に行われます。'
            }, null, 2) }] };
          }
          return { content: [{ type: "text", text: JSON.stringify(projects, null, 2) }] };
        }
        case "switch_project": {
          const roomName = args.roomName || resolveRoomName(args.projectId);
          await connectToProject(args.projectId, roomName);
          const actualRoom = _currentRoomName;
          return { content: [{ type: "text", text: `プロジェクトを切り替えました: ${args.projectId} (room: ${actualRoom})` }] };
        }
        case "current_project": {
          if (!_currentProjectId) {
            return { content: [{ type: "text", text: JSON.stringify({ connected: false, projectId: null, roomName: null }) }] };
          }
          return { content: [{ type: "text", text: JSON.stringify({ connected: true, projectId: _currentProjectId, roomName: _currentRoomName }) }] };
        }

        // --- ノードグラフ操作 (既存) ---
        case "read_graph": {
          const { yNodes, yEdges } = getYMaps();
          return {
            content: [{ type: "text", text: JSON.stringify({
              nodes: Array.from(yNodes.values()),
              edges: Array.from(yEdges.values())
            }, null, 2) }]
          };
        }
        case "add_node": {
          const { yNodes } = getYMaps();
          const id = args.id || `node-${Date.now()}`;
          const lastNode = Array.from(yNodes.values()).pop();
          const posX = lastNode ? lastNode.position.x + 360 : 0;
          const posY = lastNode ? lastNode.position.y : 0;
          const nodeClass = args.nodeClass ? `node-class-${args.nodeClass.toLowerCase()}` : '';
          _ydoc.transact(() => {
            yNodes.set(id, { id, type: 'custom', data: { label: args.label, nodeClass }, position: { x: posX, y: posY } });
          }, 'structural');
          return { content: [{ type: "text", text: `ノードを追加しました: ${id}` }] };
        }
        case "connect_nodes": {
          const { yEdges } = getYMaps();
          const edgeId = `edge-${Date.now()}`;
          _ydoc.transact(() => {
            yEdges.set(edgeId, { id: edgeId, source: args.source, target: args.target });
          }, 'structural');
          return { content: [{ type: "text", text: `エッジを作成しました: ${args.source} -> ${args.target}` }] };
        }
        case "update_node": {
          const { yNodes } = getYMaps();
          const nodeToUpdate = yNodes.get(args.id);
          if (!nodeToUpdate) throw new Error(`ノードが見つかりません: ${args.id}`);
          const updatedData = { ...nodeToUpdate.data };
          if (args.label) updatedData.label = args.label;
          if (args.nodeClass) updatedData.nodeClass = `node-class-${args.nodeClass.toLowerCase()}`;
          _ydoc.transact(() => {
            yNodes.set(args.id, { ...nodeToUpdate, data: updatedData });
          }, 'structural');
          return { content: [{ type: "text", text: `ノードを更新しました: ${args.id}` }] };
        }
        case "delete_node": {
          const { yNodes, yEdges } = getYMaps();
          _ydoc.transact(() => {
            yNodes.delete(args.id);
            for (const [edgeId, edge] of yEdges.entries()) {
              if (edge.source === args.id || edge.target === args.id) {
                yEdges.delete(edgeId);
              }
            }
          }, 'structural');
          return { content: [{ type: "text", text: `ノード ${args.id} と関連するエッジを削除しました` }] };
        }

        // --- ブロック図操作 ---
        case "list_diagrams": {
          const { yBdMeta } = getYMaps();
          const diagrams = Array.from(yBdMeta.values()).filter(Boolean);
          return { content: [{ type: "text", text: JSON.stringify(diagrams, null, 2) }] };
        }
        case "read_diagram": {
          const { yNodes } = getYMaps();
          const { yBdLayout, yBdEdges } = getBdMaps(args.diagramId);
          const nodes = [];
          for (const [nodeId, layout] of yBdLayout.entries()) {
            if (!layout) continue;
            const graphNode = yNodes.get(nodeId);
            nodes.push({
              id: nodeId,
              label: graphNode?.data?.label ?? '',
              nodeClass: graphNode?.data?.nodeClass ?? '',
              position: layout.position ?? { x: 0, y: 0 },
              shape: layout.shape ?? 'rect',
              fillColor: layout.fillColor,
              borderColor: layout.borderColor,
              width: layout.width,
              height: layout.height,
            });
          }
          const edges = Array.from(yBdEdges.values()).filter(Boolean);
          return { content: [{ type: "text", text: JSON.stringify({ diagramId: args.diagramId, nodes, edges }, null, 2) }] };
        }
        case "add_node_to_diagram": {
          const { yNodes, yBdMeta } = getYMaps();
          const { yBdLayout } = getBdMaps(args.diagramId);
          const pos = args.position ?? { x: 0, y: 0 };
          const shape = args.shape ?? 'rect';
          let nodeId = args.nodeId;

          _ydoc.transact(() => {
            if (!nodeId) {
              // 新規ノード作成
              if (!args.label) throw new Error('新規ノード作成時は label が必須です');
              nodeId = `node-${Date.now()}`;
              const nodeClass = args.nodeClass ? `node-class-${args.nodeClass.toLowerCase()}` : '';
              const lastNode = Array.from(yNodes.values()).pop();
              const graphPos = { x: lastNode ? lastNode.position.x + 360 : 0, y: lastNode ? lastNode.position.y : 0 };
              yNodes.set(nodeId, { id: nodeId, type: 'custom', data: { label: args.label, nodeClass }, position: graphPos });
            } else {
              // 既存ノードの存在確認
              if (!yNodes.has(nodeId)) throw new Error(`ノードが見つかりません: ${nodeId}`);
            }
            // ブロック図に配置
            yBdLayout.set(nodeId, {
              position: pos,
              shape,
              fillColor: '#ffffff',
              borderColor: '#888888',
              borderWidth: 1.5,
              textColor: '#111827',
              fontSize: 13,
              rotation: 0,
              width: 160,
              height: 60,
            });
            // diagramがmetaに未登録なら登録
            if (!yBdMeta.has(args.diagramId)) {
              yBdMeta.set(args.diagramId, { id: args.diagramId, name: args.diagramId, createdAt: new Date().toISOString() });
            }
          }, 'structural');
          return { content: [{ type: "text", text: `ブロック図 ${args.diagramId} にノード ${nodeId} を配置しました` }] };
        }
        case "add_edge_to_diagram": {
          const { yBdEdges } = getBdMaps(args.diagramId);
          const edgeId = `bd-edge-${Date.now()}`;
          const edgeData = { id: edgeId, source: args.source, target: args.target };
          if (args.label) edgeData.label = args.label;
          _ydoc.transact(() => {
            yBdEdges.set(edgeId, edgeData);
          }, 'structural');
          return { content: [{ type: "text", text: `ブロック図 ${args.diagramId} にエッジを追加しました: ${args.source} -> ${args.target}` }] };
        }

        // --- プロジェクト名操作 ---
        case "get_project_name": {
          const { yProjectMeta } = getYMaps();
          const name = yProjectMeta.get('name') ?? '';
          return { content: [{ type: "text", text: JSON.stringify({ name }) }] };
        }
        case "update_project_name": {
          const { yProjectMeta } = getYMaps();
          _ydoc.transact(() => {
            yProjectMeta.set('name', args.name);
          }, 'local');
          return { content: [{ type: "text", text: `プロジェクト名を更新しました: ${args.name}` }] };
        }

        default:
          throw new Error(`未知のツール: ${name}`);
      }
    });

    const transport = new SSEServerTransport("/messages", res);
    activeTransports.set(transport.sessionId, transport);

    console.log(`[SSE] Session started: ${transport.sessionId}`);

    await server.connect(transport);

    res.on("close", () => {
      console.log(`[SSE] Session closed: ${transport.sessionId}`);
      activeTransports.delete(transport.sessionId);
      server.close();
    });
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = activeTransports.get(sessionId);

    if (transport) {
      try {
        await transport.handlePostMessage(req, res);
      } catch (error) {
        console.error(`[Messages] Error: ${error.message}`);
        res.status(500).send(error.message);
      }
    } else {
      console.warn(`[Messages] Session not found: ${sessionId}`);
      res.status(404).send("Session not found");
    }
  });

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MCP HTTP Server running at http://0.0.0.0:${PORT}/sse`);
  });
}

main().catch(console.error);