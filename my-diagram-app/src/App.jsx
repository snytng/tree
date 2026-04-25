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
      padding: '12px 16px', borderRadius: '8px', background: '#fff',
      border: selected ? '2px solid #ff4444' : '1px solid #e2e8f0',
      minWidth: '120px', textAlign: 'center',
      boxShadow: selected ? '0 0 15px rgba(255, 68, 68, 0.2)' : '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      transition: 'all 0.2s ease', position: 'relative'
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
  if (nodes.length === 0) return nodes;

  const nodeIds = new Set(nodes.map(n => n.id));
  const validEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

  const adj = {};
  const inDegree = {};
  nodes.forEach(n => {
    adj[n.id] = [];
    inDegree[n.id] = 0;
  });
  validEdges.forEach(edge => {
    adj[edge.source].push(edge.target);
    inDegree[edge.target]++;
  });

  const finalNodePositions = {};
  const processedNodes = new Set();
  let currentYOffset = 0;
  const verticalGap = 40;
  const horizontalStep = 250;

  // 再帰的にサブツリーをレイアウトし、その「箱」の総高さを返す関数
  const layoutSubtree = (nodeId, x, y) => {
    if (processedNodes.has(nodeId)) return { height: 0 };
    processedNodes.add(nodeId);

    // 子ノードを取得し、現在の y 座標順にソート
    const childrenIds = (adj[nodeId] || []).filter(id => !processedNodes.has(id));
    childrenIds.sort((a, b) => {
      const nodeA = nodes.find(n => n.id === a);
      const nodeB = nodes.find(n => n.id === b);
      return (nodeA?.position?.y || 0) - (nodeB?.position?.y || 0);
    });

    let childrenBoxHeight = 0;
    childrenIds.forEach(childId => {
      const { height } = layoutSubtree(childId, x + horizontalStep, y + childrenBoxHeight);
      if (height > 0) {
        childrenBoxHeight += height + verticalGap;
      }
    });

    if (childrenIds.length > 0 && childrenBoxHeight > 0) {
      childrenBoxHeight -= verticalGap; // 最後の余白を削除
    }

    const myHeight = Math.max(50, childrenBoxHeight);
    // 親を子たちの垂直方向の中央に配置
    const myY = y + (myHeight / 2) - 25;

    finalNodePositions[nodeId] = { x, y: myY };
    return { height: myHeight };
  };

  // 1. ルートノードを現在の物理順序（y座標）でソート
  const roots = nodes
    .filter(n => inDegree[n.id] === 0)
    .sort((a, b) => a.position.y - b.position.y);

  roots.forEach(root => {
    const { height } = layoutSubtree(root.id, 0, currentYOffset);
    currentYOffset += height + verticalGap * 2; // ルート間は少し広めに空ける
  });

  // 2. ルートから辿れなかった孤立ノード（サイクル等）の救済
  nodes.forEach(node => {
    if (!finalNodePositions[node.id]) {
      const { height } = layoutSubtree(node.id, 0, currentYOffset);
      currentYOffset += height + verticalGap * 2;
    }
  });

  return nodes.map((node) => ({
    ...node,
    position: finalNodePositions[node.id] || node.position
  }));
};

const initialNodes = [];
const initialEdges = [];

function Flow() {
  const [nodes, setNodes, onNodesChangeState] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChangeState] = useEdgesState(initialEdges);
  const [isAutoLayout, setIsAutoLayout] = useState(true);
  const [projectName, setProjectName] = useState('New Project');
  const [lastAddedNodeId, setLastAddedNodeId] = useState(null);

  /**
   * [PROVISIONAL MEASURE / RISK WARNING]
   * 以下の 'pendingSelectionIdRef' および DOM フォーカスの強制移動は、
   * React Flow 内部の選択ロジックと Yjs 同期が競合し、新規ノード追加時に
   * フォーカスが古いノードに吸い寄せられる現象を回避するための暫定措置です。
   * 
   * リスク:
   * - ブラウザのイベントループの混雑状況により、フォーカス移動が追いつかない可能性があります。
   * - React Flow の仕様変更により、内部イベントの順序が変わると機能しなくなる恐れがあります。
   * 
   * 設計方針: Yjs を唯一の真実の源とし、React ステートは Yjs の観測結果 (syncState) に従います。
   */

  // 最新の状態を常に参照するためのRef (クロージャ問題と連打対策)
  const nodesRef = React.useRef(nodes);
  const edgesRef = React.useRef(edges);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  // 同期中の選択状態を保護するためのRef
  const pendingSelectionIdRef = React.useRef(null);

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

  // UndoManagerの設定
  const undoManager = useMemo(() => new Y.UndoManager([yNodes, yEdges], {
    trackedOrigins: new Set(['local'])
  }), [yNodes, yEdges]);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Undo/Redoの履歴状態を監視
  useEffect(() => {
    const updateUndoRedoState = () => {
      setCanUndo(undoManager.canUndo());
      setCanRedo(undoManager.canRedo());
    };

    undoManager.on('stack-item-added', updateUndoRedoState);
    undoManager.on('stack-item-popped', updateUndoRedoState);

    updateUndoRedoState();

    return () => {
      undoManager.off('stack-item-added', updateUndoRedoState);
      undoManager.off('stack-item-popped', updateUndoRedoState);
    };
  }, [undoManager]);

  // React Flowの変更をYjsに反映させるハンドラー
  const onNodesChange = useCallback(
    (changes) => {
      const pendingId = pendingSelectionIdRef.current;
      
      // React Flow 内部からの勝手な選択変更を完全にガードする
      const filteredChanges = changes.map(change => {
        if (change.type === 'select' && pendingId) {
          // ガード対象ID以外が選択されようとしたら阻止
          if (change.id !== pendingId && change.selected === true) {
            return { ...change, selected: false };
          }
          // ガード対象IDの選択を解除しようとしたら阻止
          if (change.id === pendingId && change.selected === false) {
            return { ...change, selected: true };
          }
        }
        return change;
      });

      // ガードされた変更をステートに適用
      onNodesChangeState(filteredChanges);

      // Yjs に反映する変更を抽出
      const changesToApplyToYjs = filteredChanges.filter(c => {
        if (c.type === 'select' && pendingId && c.id !== pendingId) return false;
        return true;
      });

      ydoc.transact(() => {
        changesToApplyToYjs.forEach((change) => {
          if (change.type === 'remove') {
            yNodes.delete(change.id);
          } else if (change.type === 'select') {
            const node = yNodes.get(change.id);
            if (node) yNodes.set(change.id, { ...node, selected: change.selected });
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
    [onNodesChangeState, yNodes, isAutoLayout] // setNodesを除去
  );

  const onEdgesChange = useCallback(
    (changes) => {
      onEdgesChangeState(changes);
      ydoc.transact(() => {
        changes.forEach((change) => {
          if (change.type === 'remove') {
            yEdges.delete(change.id);
          } else if (change.type === 'select') {
            const edge = yEdges.get(change.id);
            if (edge) yEdges.set(change.id, { ...edge, selected: change.selected });
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
      
      // 即座にステートに反映
      const nextEdges = addEdge(newEdge, edgesRef.current.map(e => ({ ...e, selected: false })));
      const nextNodes = nodesRef.current.map(n => ({ ...n, selected: false }));
      const finalNodes = isAutoLayout ? getLayoutedElements(nextNodes, nextEdges) : nextNodes;

      setNodes(finalNodes);
      setEdges(nextEdges);
      nodesRef.current = finalNodes;
      edgesRef.current = nextEdges;

      ydoc.transact(() => {
        yEdges.set(edgeId, newEdge);
        // Yjs上でも選択を同期
        yNodes.forEach((node, id) => {
          if (node.selected) yNodes.set(id, { ...node, selected: false });
        });
        yEdges.forEach((edge, id) => {
          if (edge.selected) yEdges.set(id, { ...edge, selected: false });
        });
      }, 'local');
    },
    [yNodes, yEdges, isAutoLayout, setNodes, setEdges]
  );

  // ノードが追加された際に中央へ移動するエフェクト
  useEffect(() => {
    if (lastAddedNodeId) {
      const node = nodesRef.current.find((n) => n.id === lastAddedNodeId);
      if (node) {
        // ノードのサイズ(150x50)の半分を足して中心座標を計算
        const centerX = node.position.x + 75;
        const centerY = node.position.y + 25;

        // DOM要素に直接フォーカスを当てる（React Flowの内部選択を安定させる）
        const element = document.querySelector(`[data-id="${lastAddedNodeId}"]`);
        if (element instanceof HTMLElement) {
          element.focus();
        }

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
    const selectedNodeIds = new Set(nodesRef.current.filter(n => n.selected).map(n => n.id));

    // Yjs（共有データ）からの削除も一括で行う
    ydoc.transact(() => {
      selectedNodeIds.forEach(id => yNodes.delete(id));
      edgesRef.current.forEach((edge) => {
        if (edge.selected || selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target)) {
          yEdges.delete(edge.id);
        }
      });
    }, 'local');
  }, [yNodes, yEdges]);

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

    nodesRef.current.forEach(node => {
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
    const currentMapping = edgesRef.current.map(edge => ({
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
  }, [yProjectFiles, projectName]); // Ref参照のためnodes, edgesを除去

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
  }, [yNodes, yEdges, yProjectFiles, yProjectMeta, isAutoLayout, setProjectName, fitView]);

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
  }, [yNodes, yEdges, yProjectFiles, setIsAutoLayout, fitView]);

  // ノードを追加する関数
  const onAddNode = useCallback(() => {
    const id = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[Action] Adding normal node: ${id}`);
    const label = `Node ${yNodes.size + 1}`;
    const newNode = {
      id,
      type: 'custom',
      data: { label },
      position: { x: Math.random() * 400, y: Math.random() * 400 },
      selected: true,
    };

    const nextNodes = nodesRef.current.map(n => ({ ...n, selected: false })).concat(newNode);
    const nextEdges = edgesRef.current.map(e => ({ ...e, selected: false }));
    const finalNodes = isAutoLayout ? getLayoutedElements(nextNodes, nextEdges) : nextNodes;

    setNodes(finalNodes);
    setEdges(nextEdges);
    
    // Refを即座に更新
    nodesRef.current = finalNodes;
    edgesRef.current = nextEdges;

    pendingSelectionIdRef.current = id;
    setLastAddedNodeId(id); // 移動対象としてIDを記録

    const { selected: _, ...nodeToStore } = newNode;
    ydoc.transact(() => {
      yNodes.set(id, nodeToStore);
      // 他ノードの選択解除を共有
      yNodes.forEach((node, nodeId) => {
        if (nodeId !== id && node.selected) yNodes.set(nodeId, { ...node, selected: false });
      });
    }, 'local');
  }, [yNodes, setNodes, setEdges, setLastAddedNodeId, isAutoLayout]);

  // レイアウトデバッグ情報をクリップボードにコピーする関数
  const onCopyDebugInfo = useCallback(() => {
    const debugInfo = {
      isAutoLayout,
      projectName,
      nodes: nodesRef.current.map(n => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) })),
      edges: edgesRef.current.map(e => ({ source: e.source, target: e.target }))
    };
    const text = JSON.stringify(debugInfo, null, 2);
    navigator.clipboard.writeText(text);
    alert('レイアウト情報をクリップボードにコピーしました。Geminiに共有してください。');
  }, [isAutoLayout, projectName]);

  const onAddStructuredNode = useCallback((mode) => {
    // Refから最新の状態を取得し、連打時も正確なベースノードを特定する
    const currentNodes = nodesRef.current;
    const currentEdges = edgesRef.current;

    const selectedNode = currentNodes.find(n => n.selected) || (currentNodes.length > 0 ? currentNodes[currentNodes.length - 1] : null);
    if (!selectedNode) return;

    console.log(`[Action] Adding ${mode} node. Base node:`, selectedNode.id);

    const nodeId = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const edgeId = `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    let parentId = null;
    if (mode === 'sibling') {
      const incomingEdge = currentEdges.find(e => e.target === selectedNode.id);
      parentId = incomingEdge ? incomingEdge.source : null;
    } else {
      parentId = selectedNode.id;
    }

    const newNode = {
      id: nodeId,
      type: 'custom',
      data: { label: `${mode === 'child' ? 'Child' : 'Sibling'} Node` },
      position: { x: selectedNode.position.x + 200, y: selectedNode.position.y },
      selected: true,
    };
    const newEdge = parentId ? { id: edgeId, source: parentId, target: nodeId } : null;

    // ガードフラグを立てる
    pendingSelectionIdRef.current = nodeId;

    // ローカルステートを即座に更新してフォーカスを確定させる
    const nextNodes = currentNodes.map(n => ({ ...n, selected: false })).concat(newNode);
    const nextEdges = newEdge 
      ? addEdge(newEdge, currentEdges.map(e => ({ ...e, selected: false })))
      : currentEdges.map(e => ({ ...e, selected: false }));

    const finalNodes = isAutoLayout ? getLayoutedElements(nextNodes, nextEdges) : nextNodes;
    setNodes(finalNodes);
    setEdges(nextEdges);
    nodesRef.current = finalNodes;
    edgesRef.current = nextEdges;

    const { selected: _, ...nodeToStore } = newNode;
    ydoc.transact(() => {
      yNodes.set(nodeId, nodeToStore);
      if (newEdge) yEdges.set(edgeId, newEdge);
      yNodes.forEach((node, id) => {
        if (id !== nodeId && node.selected) yNodes.set(id, { ...node, selected: false });
      });
      yEdges.forEach((edge, id) => { if (edge.selected) yEdges.set(id, { ...edge, selected: false }); });
    }, 'local');

    setLastAddedNodeId(nodeId);
  }, [yNodes, yEdges, isAutoLayout, setNodes, setEdges, setLastAddedNodeId]);

  // キーボードショートカットの制御
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 入力フォーム等にフォーカスがある場合は無視
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (['Enter', 'Insert', 'Delete', 'z', 'y'].includes(e.key)) console.log(`[Keyboard] Key pressed: ${e.key}`);

      // Undo: Ctrl+Z
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undoManager.undo();
      }
      // Redo: Ctrl+Y
      if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        undoManager.redo();
      }
      // 子ノード追加: Insert
      if (e.key === 'Insert') {
        e.preventDefault();
        onAddStructuredNode('child');
      }
      // 兄弟ノード追加: Enter
      if (e.key === 'Enter') {
        e.preventDefault();
        onAddStructuredNode('sibling');
      }
      // 削除: Delete (既存の削除ボタン機能を呼び出し)
      if (e.key === 'Delete') {
        onDeleteSelected();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoManager, onAddStructuredNode, onDeleteSelected]);

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
        const pendingId = pendingSelectionIdRef.current;
        const mergedNodes = nodesArray.map((yNode) => {
          const localNode = currentNodes.find((n) => n.id === yNode.id);
          
          // 同期時も、追加直後のノードなら選択を強制維持。そうでなければローカル状態を引き継ぐ。
          const shouldBeSelected = pendingId ? (yNode.id === pendingId) : !!localNode?.selected;
          return { ...yNode, selected: shouldBeSelected };
        });

        return isAutoLayout && mergedNodes.length > 0
          ? getLayoutedElements(mergedNodes, edgesArray)
          : mergedNodes;
      });
      
      // Yjs同期が完了した時点でガードの必要性をチェック
      const pId = pendingSelectionIdRef.current;
      if (pId && nodesArray.some(n => n.id === pId && n.selected)) {
        // ガード解除をスケジュール。React Flowのイベントループが落ち着くまで長めの猶予を持たせる。
        setTimeout(() => { 
          if (pendingSelectionIdRef.current === pId) {
            pendingSelectionIdRef.current = null; 
          }
        }, 800);
      }

      setEdges((currentEdges) => {
        const nextEdges = edgesArray.map((yEdge) => {
          const localEdge = currentEdges.find((e) => e.id === yEdge.id);
          return localEdge ? { ...yEdge, selected: localEdge.selected } : yEdge;
        });
        return nextEdges;
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

  // 背景クリックでガードを強制解除 (pendingIdが設定されている場合のみ)
  const onPaneClick = useCallback(() => {
    if (pendingSelectionIdRef.current) {
      console.log(`[Action] Pane clicked: Clearing guard for ${pendingSelectionIdRef.current}`);
      pendingSelectionIdRef.current = null;
    }
  }, []);

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
          padding: 0;
          margin: 0;
          box-sizing: border-box;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .btn-icon::after {
          content: attr(data-tooltip);
          position: absolute;
          right: 50px;
          background: #333;
          background: rgba(26, 25, 43, 0.9);
          backdrop-filter: blur(4px);
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
        .btn-icon:hover {
          background-color: #f8fafc !important;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
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
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onPaneClick={onPaneClick}
        nodesDraggable={!isAutoLayout}
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
          <button className="btn-icon" data-tooltip="デバッグ情報コピー" onClick={onCopyDebugInfo} style={{ backgroundColor: '#fff', border: '2px solid #6366f1', color: '#6366f1', borderRadius: '4px', cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v2H7v-2zm0 4h2v2H7v-2zm0-8h2v2H7V6zm4 4h6v2h-6v-2zm0 4h6v2h-6v-2zm0-8h6v2h-6V6z"/></svg>
          </button>
          <label className="btn-icon" data-tooltip="プロジェクト・インポート" style={{ backgroundColor: '#fff', border: '2px solid #4caf50', borderRadius: '4px', cursor: 'pointer', color: '#4caf50' }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            <input type="file" accept=".zip" onChange={onImportProject} style={{ display: 'none' }} />
          </label>
          <button className="btn-icon" data-tooltip="プロジェクト・エクスポート" onClick={onExportProject} style={{ backgroundColor: '#fff', border: '2px solid #4caf50', color: '#4caf50', borderRadius: '4px', cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 20h14v-2H5v2zM19 11l-7-7-7 7h4v6h6v-6h4z"/></svg>
          </button>
          <button className="btn-icon" data-tooltip="元に戻す (Ctrl+Z)" onClick={() => undoManager.undo()} disabled={!canUndo} style={{ backgroundColor: '#fff', border: `2px solid ${canUndo ? '#64748b' : '#e2e8f0'}`, color: canUndo ? '#64748b' : '#e2e8f0', borderRadius: '4px', cursor: canUndo ? 'pointer' : 'not-allowed', opacity: canUndo ? 1 : 0.5 }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
          </button>
          <button className="btn-icon" data-tooltip="やり直し (Ctrl+Y)" onClick={() => undoManager.redo()} disabled={!canRedo} style={{ backgroundColor: '#fff', border: `2px solid ${canRedo ? '#64748b' : '#e2e8f0'}`, color: canRedo ? '#64748b' : '#e2e8f0', borderRadius: '4px', cursor: canRedo ? 'pointer' : 'not-allowed', opacity: canRedo ? 1 : 0.5 }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>
          </button>
          <button
            className="btn-icon"
            data-tooltip={isAutoLayout ? "自動レイアウト解除" : "自動レイアウト適用"}
            onClick={() => {
              if (isAutoLayout) {
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
          <button className="btn-icon" data-tooltip="ノードを追加" onClick={onAddNode} style={{ backgroundColor: '#fff', border: '2px solid #1a192b', borderRadius: '4px', cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          </button>
          <button className="btn-icon" data-tooltip="選択要素を削除" onClick={onDeleteSelected} style={{ backgroundColor: '#fff', border: '2px solid #ff9800', color: '#ff9800', borderRadius: '4px', cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
          <button className="btn-icon" data-tooltip="全リセット" onClick={onReset} style={{ backgroundColor: '#fff', border: '2px solid #f44336', color: '#f44336', borderRadius: '4px', cursor: 'pointer' }}>
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