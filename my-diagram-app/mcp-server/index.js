const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { SSEServerTransport } = require("@modelcontextprotocol/sdk/server/sse.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const express = require("express");
const Y = require('yjs');
const { WebsocketProvider } = require('y-websocket');
const ws = require('ws');

// MCPサーバーの初期化
const server = new Server(
  { name: "diagram-app-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Yjs設定 (ヘッドレスクライアントとして動作)
const ROOM_NAME = 'react-flow-demo-room';
const ydoc = new Y.Doc();
const wsProvider = new WebsocketProvider('ws://localhost:1234', ROOM_NAME, ydoc, { WebSocketPolyfill: ws });

const yNodes = ydoc.getMap('nodes');
const yEdges = ydoc.getMap('edges');

// 利用可能なツールの定義
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
          id: { type: "string", description: "任意のID（指定しない場合は自動生成）" }
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
    }
  ]
}));

// ツール実行ハンドラ
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

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
      // 既存のノードがある場合、最後のノードの少し右側に配置するヒントを与える
      const lastNode = Array.from(yNodes.values()).pop();
      const posX = lastNode ? lastNode.position.x + 360 : 0;
      const posY = lastNode ? lastNode.position.y : 0;

      ydoc.transact(() => {
        yNodes.set(id, {
          id, type: 'custom', data: { label: args.label },
          position: { x: posX, y: posY }
        });
      }, 'structural');
      return { content: [{ type: "text", text: `ノードを追加しました: ${id}` }] };

    case "connect_nodes":
      const edgeId = `edge-${Date.now()}`;
      ydoc.transact(() => {
        yEdges.set(edgeId, { id: edgeId, source: args.source, target: args.target });
      }, 'structural');
      return { content: [{ type: "text", text: `エッジを作成しました: ${args.source} -> ${args.target}` }] };

    default:
      throw new Error(`未知のツール: ${name}`);
  }
});

async function main() {
  const app = express();
  let transport;

  // SSEコネクションを確立するエンドポイント
  app.get("/sse", async (req, res) => {
    transport = new SSEServerTransport("/messages", res);
    await server.connect(transport);
  });

  // AIクライアントからのメッセージを受け取るエンドポイント
  app.post("/messages", async (req, res) => {
    if (transport) {
      await transport.handlePostMessage(req, res);
    }
  });

  const PORT = 3000;
  app.listen(PORT, () => {
    console.error(`MCP HTTP Server running at http://localhost:${PORT}/sse`);
  });
}

main().catch(console.error);