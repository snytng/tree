const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const express = require("express");
const cors = require("cors");
const Y = require('yjs');
const { WebsocketProvider } = require('y-websocket');
const ws = require('ws');

// Yjs設定 (ヘッドレスクライアントとして動作)
const ROOM_NAME = 'react-flow-demo-room';
const ydoc = new Y.Doc();
const wsProvider = new WebsocketProvider('ws://localhost:1234', ROOM_NAME, ydoc, { WebSocketPolyfill: ws });

const yNodes = ydoc.getMap('nodes');
const yEdges = ydoc.getMap('edges');

async function main() {
  const app = express();
  app.use(cors()); // インスペクター（ブラウザ）からの接続を許可

  // 【重要】express.json() は削除またはコメントアウトしてください。
  // MCP SDKの SSEServerTransport が内部でリクエストストリームを直接読み取るため、
  // ここでパースしてしまうと通信が失敗します。

  // アクティブなトランスポートをセッションIDで管理
  const activeTransports = new Map();

  // SSEコネクションを確立するエンドポイント
  app.get("/sse", async (req, res) => {
    console.log(`[SSE] New connection request from ${req.ip}`);
    // クライアントごとに個別のServerインスタンスを生成
    const server = new Server(
      { name: "diagram-app-mcp", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    // 利用可能なツールの定義を登録
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "read_graph",
          description: "現在の図面の全ノードとエッジを取得します",
          inputSchema: { type: "object", properties: {} }
        },
        {
          name: "add_node",
          description: "図面に新しいノードを追加します",
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
          description: "2つのノード間にエッジ（矢印）を作成します",
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
        }
      ]
    }));

    // ツール実行ハンドラを登録
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      console.log(`[Tool Call] ${name}`, args);
      switch (name) {
        case "read_graph":
          return {
            content: [{ type: "text", text: JSON.stringify({
              nodes: Array.from(yNodes.values()),
              edges: Array.from(yEdges.values())
            }, null, 2) }]
          };
        case "add_node":
          const id = args.id || `node-${Date.now()}`;
          const lastNode = Array.from(yNodes.values()).pop();
          const posX = lastNode ? lastNode.position.x + 360 : 0;
          const posY = lastNode ? lastNode.position.y : 0;
          const nodeClass = args.nodeClass ? `node-class-${args.nodeClass.toLowerCase()}` : '';
          ydoc.transact(() => {
            yNodes.set(id, { id, type: 'custom', data: { label: args.label, nodeClass }, position: { x: posX, y: posY } });
          }, 'structural');
          return { content: [{ type: "text", text: `ノードを追加しました: ${id}` }] };
        case "connect_nodes":
          const edgeId = `edge-${Date.now()}`;
          ydoc.transact(() => {
            yEdges.set(edgeId, { id: edgeId, source: args.source, target: args.target });
          }, 'structural');
          return { content: [{ type: "text", text: `エッジを作成しました: ${args.source} -> ${args.target}` }] };

        case "update_node":
          const nodeToUpdate = yNodes.get(args.id);
          if (!nodeToUpdate) throw new Error(`ノードが見つかりません: ${args.id}`);
          const updatedData = { ...nodeToUpdate.data };
          if (args.label) updatedData.label = args.label;
          if (args.nodeClass) updatedData.nodeClass = `node-class-${args.nodeClass.toLowerCase()}`;
          
          ydoc.transact(() => {
            yNodes.set(args.id, { ...nodeToUpdate, data: updatedData });
          }, 'structural');
          return { content: [{ type: "text", text: `ノードを更新しました: ${args.id}` }] };

        case "delete_node":
          ydoc.transact(() => {
            // ノードを削除
            yNodes.delete(args.id);
            // 関連するエッジもすべて削除
            for (const [edgeId, edge] of yEdges.entries()) {
              if (edge.source === args.id || edge.target === args.id) {
                yEdges.delete(edgeId);
              }
            }
          }, 'structural');
          return { content: [{ type: "text", text: `ノード ${args.id} と関連するエッジを削除しました` }] };

        default:
          throw new Error(`未知のツール: ${name}`);
      }
    });

    const transport = new SSEServerTransport("/messages", res);
    activeTransports.set(transport.sessionId, transport);

    console.log(`[SSE] Session started: ${transport.sessionId}`);

    await server.connect(transport);

    // コネクション終了時のクリーンアップ
    res.on("close", () => {
      console.log(`[SSE] Session closed: ${transport.sessionId}`);
      activeTransports.delete(transport.sessionId);
      server.close();
    });
  });

  // AIクライアントからのメッセージを受け取るエンドポイント
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