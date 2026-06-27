const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const express = require("express");
const cors = require("cors");
const http = require('http');
const Y = require('yjs');
const { setupWSConnection } = require('y-websocket/bin/utils');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

// ============================================================
// Yjs Connection Manager (D-058)
// プロジェクトごとに動的にYjsルームへ接続を切り替える
// ============================================================
let _currentProjectId = null;
let _ydoc = null;
let _currentRoomName = null;

function connectToProject(projectId, roomName) {
  if (_ydoc) {
    _ydoc.destroy();
    _ydoc = null;
  }

  if (!projectId) {
    _currentProjectId = null;
    _currentRoomName = null;
    console.log('[Yjs] Disconnected (no project)');
    return;
  }

  _currentRoomName = roomName || `mda_${projectId}`;
  _ydoc = new Y.Doc();
  _currentProjectId = projectId;
  console.log(`[Yjs] Y.Doc for room '${_currentRoomName}' is ready. Waiting for client connections.`);
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
// Project Registry API & WebSocket (D-058)
// プロジェクト一覧の管理とリアルタイム同期
// ============================================================
const DB_PATH = path.join(__dirname, 'projects.json');

function readProjects() {
  if (!fs.existsSync(DB_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (e) {
    console.error('[Registry] Failed to read or parse projects.json', e);
    return [];
  }
}

function writeProjects(projects) {
  fs.writeFileSync(DB_PATH, JSON.stringify(projects, null, 2));
}

function setupRegistryEndpoints(app, registryWss) {
  // 接続している全クライアントにブロードキャストする関数
  const broadcastProjectUpdate = () => {
    const projects = readProjects();
    // WebSocketServer.clients は Node.js の ws ライブラリのプロパティ
    if (registryWss && registryWss.clients) {
      const message = JSON.stringify({ type: 'projects_updated', payload: projects });
      for (const client of registryWss.clients) {
        if (client.readyState === client.OPEN) {
          client.send(message);
        }
      }
    }
  };

  app.get('/api/projects', (req, res) => res.json(readProjects()));

  app.post('/api/projects', (req, res) => {
    const projects = readProjects();
    const newProject = {
      id: `proj_${randomUUID().slice(0, 8)}`,
      name: req.body.name || '新規プロジェクト',
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };
    projects.push(newProject);
    writeProjects(projects);
    broadcastProjectUpdate();
    res.status(201).json(newProject);
  });

  app.delete('/api/projects/:id', (req, res) => {
    let projects = readProjects();
    projects = projects.filter(p => p.id !== req.params.id);
    writeProjects(projects);
    broadcastProjectUpdate();
    res.status(204).send();
  });

  app.put('/api/projects/:id', (req, res) => {
    const projects = readProjects();
    const project = projects.find(p => p.id === req.params.id);
    if (project) {
      project.name = req.body.name;
      project.lastModified = new Date().toISOString();
      writeProjects(projects);
      broadcastProjectUpdate();
      res.json(project);
    } else {
      res.status(404).send('Project not found');
    }
  });
}

// ============================================================
// MCP Server
// ============================================================
async function main() {
  const app = express();
  // CORS設定を明示的に行う
  app.use(cors({
    origin: 'http://localhost:5173', // フロントエンドのオリジンを許可
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  }));

  // APIリクエスト用に express.json() を使用
  app.use(express.json());

  const setupMcpServer = (app) => {
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
          name: "switch_project",
          description: "Yjsルームを指定プロジェクトに切り替えます。roomNameを省略すると 'mda_{projectId}' が使用されます。",
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
        case "switch_project": {
          const roomName = args.roomName; // roomNameはconnectToProject内で解決
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
  };

  // --- HTTP & WebSocket Server Setup ---
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const registryWss = new WebSocketServer({ noServer: true });

  // プロジェクト一覧APIをセットアップ
  setupRegistryEndpoints(app, registryWss);

  // MCPサーバーをセットアップ
  setupMcpServer(app);

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url, `http://${request.headers.host}`);
    
    if (pathname === '/ws-registry') {
      registryWss.handleUpgrade(request, socket, head, (ws) => {
        registryWss.emit('connection', ws, request);
      });
    } else {
      // y-websocket用の接続ハンドリング
      wss.handleUpgrade(request, socket, head, (ws) => {
        // _ydoc が現在接続中のプロジェクトのY.Docを指すようにする
        setupWSConnection(ws, request, { doc: _ydoc });
      });
    }
  });

  const PORT = 1234; // フロントエンドが接続するポート
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`MCP, API, and WebSocket server running at http://0.0.0.0:${PORT}`);
  });
}

main().catch(console.error);