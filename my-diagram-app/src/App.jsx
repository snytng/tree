import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  useNodesState,
  useEdgesState,
  Panel,
  MarkerType, // MarkerTypeをインポート
  ReactFlowProvider,
  useReactFlow,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import dagre from 'dagre';
import mappingData from '../mapping.json';
import JSZip from 'jszip';

import specRaw from '../spec.md?raw';
import designRaw from '../design.md?raw';

const ROOM_NAME = 'react-flow-demo-room';
// Yjsドキュメントの初期化
const ydoc = new Y.Doc();
// 部屋名 'react-flow-demo-room' でWebRTCプロバイダーを設定
const provider = new WebrtcProvider('react-flow-demo-room', ydoc);
// ローカルストレージ（IndexedDB）への永続化
const indexeddb = new IndexeddbPersistence(ROOM_NAME, ydoc);

// 左右にハンドルを持つカスタムノードの定義
const CustomNode = ({ data, selected }) => {
  return (
    <div style={{ 
      padding: '10px', 
      borderRadius: '5px', 
      background: '#fff', 
      border: selected ? '2px solid #ff0000' : '1px solid #1a192b', // 選択時に赤枠
      minWidth: '100px', 
      textAlign: 'center',
      boxShadow: selected ? '0 0 10px rgba(255, 0, 0, 0.3)' : 'none' // 選択時に光らせる
    }}>
      <Handle type="target" position={Position.Left} style={{ borderRadius: 0 }} />
      <div>{data.label}</div>
      <Handle type="source" position={Position.Right} style={{ borderRadius: 0 }} />
    </div>
  );
};

// nodeTypesはコンポーネントの外で定義するか、memo化する必要があります
const nodeTypes = {
  custom: CustomNode,
  default: CustomNode, // デフォルトのノードタイプも左右ハンドルに設定
};

// 自動レイアウト計算関数
const getLayoutedElements = (nodes, edges) => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 100 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    // ノードのサイズを計算の基準にする（カスタムノードのサイズに合わせる）
    g.setNode(node.id, { width: 150, height: 50 });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 75,
        y: nodeWithPosition.y - 25,
      },
    };
  });
};

const initialNodes = [];
const initialEdges = [];

function Flow() {
  const [nodes, setNodes, onNodesChangeState] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChangeState] = useEdgesState(initialEdges);
  const [isAutoLayout, setIsAutoLayout] = useState(true);
  const [projectName, setProjectName] = useState('New Project');
  const [lastAddedNodeId, setLastAddedNodeId] = useState(null);

  const { setCenter, getViewport, fitView } = useReactFlow();

  // デフォルトのエッジオプションを定義
  const defaultEdgeOptions = useMemo(() => ({
    animated: false, // 必要であればアニメーションを有効に
    style: { strokeWidth: 2, stroke: '#333' }, // エッジのスタイル
    markerEnd: {
      type: MarkerType.ArrowClosed, // 終端を閉じた矢印にする
      color: '#333', // 矢印の色
    },
  }), []);

  // Yjsの共有型（Map）を取得。IDをキーにすることで、個別の要素を効率的に同期できる
  const yNodes = ydoc.getMap('nodes');
  const yEdges = ydoc.getMap('edges');
  const yProjectFiles = ydoc.getMap('projectFiles'); // 動的なファイル保存用
  const yProjectMeta = ydoc.getMap('projectMeta'); // プロジェクト名などのメタデータ用

  // React Flowの変更をYjsに反映させるハンドラー
  const onNodesChange = useCallback(
    (changes) => {
      // まず手元のUIを更新
      onNodesChangeState(changes);

      // 自動レイアウト時は位置の変更をYjsに同期しない（計算結果が優先されるため）
      ydoc.transact(() => {
        changes.forEach((change) => {
          if (change.type === 'remove') {
            yNodes.delete(change.id);
          } else if (!isAutoLayout && (change.type === 'position' || change.type === 'dimensions')) {
            const node = yNodes.get(change.id);
            if (node) {
              const updatedNode = { ...node };
              if (change.position) updatedNode.position = change.position;
              if (change.dimensions) {
                updatedNode.width = change.dimensions.width;
                updatedNode.height = change.dimensions.height;
              }
              yNodes.set(change.id, updatedNode);
            }
          }
        });
      }, 'local');
    },
    [onNodesChangeState, yNodes, isAutoLayout]
  );

  const onEdgesChange = useCallback(
    (changes) => {
      onEdgesChangeState(changes);
      ydoc.transact(() => {
        changes.forEach((change) => {
          if (change.type === 'remove') {
            yEdges.delete(change.id);
          }
        });
      }, 'local');
    },
    [onEdgesChangeState, yEdges]
  );

  const onConnect = useCallback(
    (params) => {
      // エッジのIDを生成してYjsに追加
      const edgeId = `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const newEdge = { ...params, id: edgeId };
      
      // 手元の状態を即座に更新
      setEdges((eds) => {
        const nextEdges = addEdge(newEdge, eds);
        if (isAutoLayout) {
          // 接続時も即座に再配置
          setNodes((nds) => getLayoutedElements(nds, nextEdges));
        }
        return nextEdges;
      });

      ydoc.transact(() => {
        yEdges.set(edgeId, newEdge);
      }, 'local');
    },
    [setEdges, setNodes, yEdges, isAutoLayout]
  );

  // ノードが追加された際に中央へ移動するエフェクト
  useEffect(() => {
    if (lastAddedNodeId) {
      const node = nodes.find((n) => n.id === lastAddedNodeId);
      if (node) {
        // ノードのサイズ(150x50)の半分を足して中心座標を計算
        const centerX = node.position.x + 75;
        const centerY = node.position.y + 25;

        setCenter(centerX, centerY, {
          zoom: getViewport().zoom,
          duration: 500, // 500msで素早く移動
        });
        setLastAddedNodeId(null);
      }
    }
  }, [nodes, lastAddedNodeId, setCenter, getViewport]);

  // 選択された要素を削除する関数
  const onDeleteSelected = useCallback(() => {
    ydoc.transact(() => {
      nodes.forEach((node) => {
        if (node.selected) yNodes.delete(node.id);
      });
      edges.forEach((edge) => {
        if (edge.selected) yEdges.delete(edge.id);
      });
    }, 'local');

    // syncStateで 'local' をスキップしているため、手元の状態も即座に更新する
    setNodes((nds) => nds.filter((node) => !node.selected));
    setEdges((eds) => eds.filter((edge) => !edge.selected));
  }, [nodes, edges, yNodes, yEdges, setNodes, setEdges]);

  // MarkdownからIDとタイトルを抽出するヘルパー
  const extractMetadata = (text) => {
    // ## {セクション番号}. [ID] タイトル という形式に対応 (行頭マッチングを強化)
    const regex = /^\s*##.*\[([A-Z]-\d{3})\]\s*(.*)$/gm;
    const metadata = {};
    let match;
    while ((match = regex.exec(text)) !== null) {
      metadata[match[1]] = match[2].trim();
    }
    return metadata;
  };

  // プロジェクトのエクスポート (ZIP出力)
  const onExportProject = useCallback(async () => {
    const zip = new JSZip();
    
    // Markdownファイルの再構築と保存
    // yProjectFilesにデータがあればそれを使用、なければ現在のノードから再構築
    const exportedSpecContent = [];
    const exportedDesignContent = [];

    nodes.forEach(node => {
      if (node.id.startsWith('S-')) {
        exportedSpecContent.push(`## [${node.id}] ${node.data.label.replace(`${node.id}: `, '')}`);
      } else if (node.id.startsWith('D-')) {
        exportedDesignContent.push(`## [${node.id}] ${node.data.label.replace(`${node.id}: `, '')}`);
      }
    });

    // 既存のyProjectFilesの内容を優先しつつ、ノードから再構築した内容を追加
    const finalSpecContent = yProjectFiles.get('spec.md') || exportedSpecContent.join('\n\n');
    const finalDesignContent = yProjectFiles.get('design.md') || exportedDesignContent.join('\n\n');

    if (finalSpecContent) {
      zip.file('spec.md', finalSpecContent);
    }
    if (finalDesignContent) {
      zip.file('design.md', finalDesignContent);
    }

    // その他のyProjectFilesに保存されているファイルも追加
    yProjectFiles.forEach((content, filename) => {
      if (!['spec.md', 'design.md'].includes(filename)) { // spec.mdとdesign.mdは上記で処理済み
        zip.file(filename, content);
      }
    });

    // mapping.json の動的生成
    const currentMapping = edges.map(edge => ({
      from: edge.source,
      to: edge.target,
      type: edge.label || 'realizes'
    }));
    zip.file('mapping.json', JSON.stringify(currentMapping, null, 2));

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${projectName || 'project'}-${Date.now()}.zip`;
    link.click();
  }, [nodes, edges, yProjectFiles, projectName]);

  // プロジェクトのインポート (ZIP読み込み)
  const onImportProject = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    console.group('📂 Project Import Debug');
    console.log('1. Selected File:', file.name, `(${file.size} bytes)`);

    try {
      const zip = await JSZip.loadAsync(file);
      const filesData = {};
      let importedMapping = [];

      console.log('2. Unzipping files...');
      for (const [filename, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;
        const content = await zipEntry.async('string');
        const baseName = filename.split('/').pop(); // フォルダ階層を無視してファイル名のみ取得
        
        if (baseName === 'mapping.json') {
          console.log('   - Found mapping.json');
          importedMapping = JSON.parse(content);
        } else if (baseName.endsWith('.md')) {
          console.log(`   - Found Markdown: ${baseName}`);
          filesData[baseName] = content;
        }
      }

      const allMetadata = {};
      Object.values(filesData).forEach(content => {
        Object.assign(allMetadata, extractMetadata(content));
      });

      console.log('3. Extracted IDs:', Object.keys(allMetadata));
      console.log('4. Mapping entries:', importedMapping.length);

      const newNodes = Object.entries(allMetadata).map(([id, title]) => ({
        id,
        type: 'custom',
        data: { label: `${id}: ${title}` },
        position: { x: 0, y: 0 },
      }));

      const newEdges = importedMapping.map((link, idx) => ({
        id: `e-${idx}`,
        source: link.from,
        target: link.to,
        label: link.type,
      }));

      console.log('5. Final data structure:', { nodes: newNodes.length, edges: newEdges.length });

      // 手元の状態を即座に更新（自動レイアウト適用）
      const layoutedNodes = isAutoLayout && newNodes.length > 0 
        ? getLayoutedElements(newNodes, newEdges) 
        : newNodes;
      
      setNodes(layoutedNodes);
      setEdges(newEdges);

      const newProjectName = file.name.replace('.zip', '');
      setProjectName(newProjectName); // 手元のステートを即座に更新

      // 描画後に全体が収まるように調整
      setTimeout(() => fitView({ duration: 800, padding: 0.2 }), 100);

      ydoc.transact(() => {
        yProjectMeta.set('name', newProjectName);
        yProjectFiles.clear();
        Object.entries(filesData).forEach(([name, content]) => {
          yProjectFiles.set(name, content);
        });

        yNodes.clear();
        newNodes.forEach(node => yNodes.set(node.id, node));

        yEdges.clear();
        newEdges.forEach(edge => yEdges.set(edge.id, edge));
      }, 'local');
      
      console.log('✅ Project imported successfully');
    } catch (error) {
      console.error('❌ Error importing project:', error);
    } finally {
      console.groupEnd();
    }
  }, [yNodes, yEdges, yProjectFiles, yProjectMeta, setNodes, setEdges, isAutoLayout, setProjectName, fitView]);

  // ドキュメントツリーをインポートする関数
  const onImportDocTree = useCallback(() => {
    console.log('onImportDocTree: Started');
    try {
      // yProjectFilesが空ならデフォルト（内蔵MD）を使用
      const hasDynamicFiles = yProjectFiles.size > 0;
      const specContent = hasDynamicFiles ? (yProjectFiles.get('spec.md') || specRaw) : specRaw;
      const designContent = hasDynamicFiles ? (yProjectFiles.get('design.md') || designRaw) : designRaw;

      const docMetadata = {
        ...extractMetadata(specContent),
        ...extractMetadata(designContent)
      };

      const newNodes = Object.entries(docMetadata).map(([id, title]) => ({
        id,
        type: 'custom',
        data: { label: `${id}: ${title}` },
        position: { x: 0, y: 0 },
      }));

      const newEdges = mappingData.map((link, index) => ({
        id: `e-doc-${index}`,
        source: link.from,
        target: link.to,
        label: link.type,
      }));

      console.log('onImportDocTree: Data generated', { nodesCount: newNodes.length, edgesCount: newEdges.length });

      // 1. 手元の状態を即座に更新（自動レイアウトを適用）
      const layoutedNodes = isAutoLayout ? getLayoutedElements(newNodes, newEdges) : newNodes;
      setNodes(layoutedNodes);
      setEdges(newEdges);

      // 全体が収まるように調整
      setTimeout(() => fitView({ duration: 800, padding: 0.2 }), 100);

      // 2. Yjsに共有
      ydoc.transact(() => {
        newNodes.forEach(node => yNodes.set(node.id, node));
        newEdges.forEach(edge => yEdges.set(edge.id, edge));
      }, 'local');

      setIsAutoLayout(true);
      console.log('onImportDocTree: Success');
    } catch (error) {
      console.error('onImportDocTree: Error occurred', error);
    }
  }, [yNodes, yEdges, setIsAutoLayout, setNodes, setEdges, isAutoLayout, fitView]);

  // ノードを追加する関数
  const onAddNode = useCallback(() => {
    const id = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newNode = {
      id,
      type: 'custom', // 作成したカスタムノードを使用
      data: { label: `Node ${yNodes.size + 1}` },
      position: { x: Math.random() * 400, y: Math.random() * 400 },
    };
    
    // 手元の状態を即座に更新
    setNodes((nds) => {
      const nextNodes = nds.concat(newNode);
      if (isAutoLayout) {
        // 自動レイアウト時は追加と同時に配置を計算（一瞬で整列）
        const edgesArray = Array.from(yEdges.values());
        return getLayoutedElements(nextNodes, edgesArray);
      }
      return nextNodes;
    });
    setLastAddedNodeId(id); // 移動対象としてIDを記録

    ydoc.transact(() => {
      yNodes.set(id, newNode);
    }, 'local');
  }, [yNodes, yEdges, setNodes, setLastAddedNodeId, isAutoLayout]);

  // 全てのデータをリセットする関数
  const onReset = useCallback(() => {
    if (!window.confirm('キャンバスを空にしますか？（この操作は取り消せません）')) return;
    ydoc.transact(() => {
      yNodes.clear();
      yEdges.clear();
    }, 'local');
    setNodes([]);
    setEdges([]);
  }, [yNodes, yEdges, setNodes, setEdges]);

  // Yjs側からの変更を監視してReactの状態に反映
  useEffect(() => {
    const syncState = (event) => {
      if (event && event.transaction.origin === 'local') return;
      
      const nodesArray = Array.from(yNodes.values());
      const edgesArray = Array.from(yEdges.values());

      const metaName = yProjectMeta.get('name');
      if (metaName) setProjectName(metaName);

      // 現在の選択状態を維持しながら同期する
      setNodes((currentNodes) => {
        const mergedNodes = nodesArray.map((yNode) => {
          const localNode = currentNodes.find((n) => n.id === yNode.id);
          // Yjsからのデータに、ローカルでのみ保持しているselected状態を合体させる
          return localNode ? { ...yNode, selected: localNode.selected } : yNode;
        });

        return isAutoLayout && mergedNodes.length > 0
          ? getLayoutedElements(mergedNodes, edgesArray)
          : mergedNodes;
      });

      setEdges((currentEdges) => {
        return edgesArray.map((yEdge) => {
          const localEdge = currentEdges.find((e) => e.id === yEdge.id);
          return localEdge ? { ...yEdge, selected: localEdge.selected } : yEdge;
        });
      });
    };

    // 初期ロード
    syncState();

    yNodes.observe(syncState);
    yEdges.observe(syncState);
    yProjectMeta.observe(syncState);

    return () => {
      yNodes.unobserve(syncState);
      yEdges.unobserve(syncState);
      yProjectMeta.unobserve(syncState);
    };
  }, [yNodes, yEdges, yProjectMeta, setNodes, setEdges, isAutoLayout]);

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        .react-flow__edge.selected .react-flow__edge-path {
          stroke: #ff0000 !important;
          stroke-width: 3;
        }
        .react-flow__edge.selected marker path {
          fill: #ff0000 !important;
        }
        .btn-icon {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .btn-icon::after {
          content: attr(data-tooltip);
          position: absolute;
          right: 50px;
          background: #333;
          color: #fff;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          white-space: nowrap;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s;
        }
        .btn-icon:hover::after {
          opacity: 1;
        }
        .btn-icon svg {
          width: 20px;
          height: 20px;
        }
      `}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes} // カスタムノードを登録
        defaultEdgeOptions={defaultEdgeOptions} // ここでデフォルトのエッジオプションを適用
        nodesDraggable={!isAutoLayout} // 自動レイアウト時はドラッグを無効化
        fitView
      >
        <Background />
        <Controls />
        <Panel position="top-left">
          <div style={{ 
            background: '#fff', 
            padding: '8px 12px', 
            borderRadius: '4px', 
            border: '2px solid #1a192b',
            boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
          }}>
            <span style={{ fontSize: '10px', color: '#666', display: 'block', lineHeight: 1 }}>PROJECT</span>
            <strong style={{ fontSize: '14px' }}>{projectName}</strong>
          </div>
        </Panel>

        <Panel position="top-right" style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
          <label 
            className="btn-icon" 
            data-tooltip="プロジェクト・インポート"
            style={{ backgroundColor: '#fff', border: '2px solid #4caf50', borderRadius: '4px', cursor: 'pointer', color: '#4caf50' }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            <input type="file" accept=".zip" onChange={onImportProject} style={{ display: 'none' }} />
          </label>

          <button 
            className="btn-icon" 
            data-tooltip="プロジェクト・エクスポート"
            onClick={onExportProject} 
            style={{ backgroundColor: '#fff', border: '2px solid #4caf50', color: '#4caf50', borderRadius: '4px', cursor: 'pointer' }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 20h14v-2H5v2zM19 11l-7-7-7 7h4v6h6v-6h4z"/></svg>
          </button>

          <button 
            className="btn-icon"
            data-tooltip={isAutoLayout ? "自動レイアウト解除" : "自動レイアウト適用"}
            onClick={() => {
              if (isAutoLayout) {
                // 自動レイアウトから手動レイアウトへ切り替える際、
                // 現在の計算済み座標を Yjs に保存してレイアウトを維持する
                console.log('Switching to manual: Persisting layout positions...');
                ydoc.transact(() => {
                  nodes.forEach((node) => {
                    const yNode = yNodes.get(node.id);
                    if (yNode) {
                      yNodes.set(node.id, { ...yNode, position: node.position });
                    }
                  });
                }, 'local');
              }
              setIsAutoLayout(!isAutoLayout);
            }}
            style={{ 
              backgroundColor: isAutoLayout ? '#1a192b' : '#fff',
              color: isAutoLayout ? '#fff' : '#1a192b',
              border: '2px solid #1a192b',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.5 5.6L10 7L8.6 4.5L10 2L7.5 3.4L5 2L6.4 4.5L5 7L7.5 5.6ZM19.5 15.4L17 14L18.4 16.5L17 19L19.5 17.6L22 19L20.6 16.5L22 14L19.5 15.4ZM22 2L19.5 3.4L17 2L18.4 4.5L17 7L19.5 5.6L22 7L20.6 4.5L22 2ZM14.1 5.9L3 17L7 21L18.1 9.9L14.1 5.9ZM16.6 7.4L14.6 5.4L15.9 4.1L17.9 6.1L16.6 7.4Z"/></svg>
          </button>

          <button 
            className="btn-icon"
            data-tooltip="ノードを追加"
            onClick={onAddNode} 
            style={{ backgroundColor: '#fff', border: '2px solid #1a192b', borderRadius: '4px', cursor: 'pointer' }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          </button>

          <button 
            className="btn-icon"
            data-tooltip="選択要素を削除"
            onClick={onDeleteSelected} 
            style={{ backgroundColor: '#fff', border: '2px solid #ff9800', color: '#ff9800', borderRadius: '4px', cursor: 'pointer' }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>

          <button 
            className="btn-icon"
            data-tooltip="全リセット"
            onClick={onReset} 
            style={{ backgroundColor: '#fff', border: '2px solid #f44336', color: '#f44336', borderRadius: '4px', cursor: 'pointer' }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}