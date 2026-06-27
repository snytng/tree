import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  SelectionMode, // 追加
} from 'reactflow';
import 'reactflow/dist/style.css';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { WebsocketProvider } from 'y-websocket'; // y-websocketはApp.jsxで直接使用するため、ルートのpackage.jsonにも必要
import { IndexeddbPersistence } from 'y-indexeddb';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useViewSync } from './hooks/useViewSync';
import ViewSyncToolbar from './components/ViewSyncToolbar';
import { useNodeEditor } from './hooks/useNodeEditor';
import CustomNode from './hooks/CustomNode';
import { useFileIO } from './hooks/useFileIO';
import RubberBandEdge from './components/RubberBandEdge';
import { getLayoutedElements } from './utils/layoutEngine';
import { isDescendant, parseHierarchyText, generateHierarchyText } from './utils/graphUtils';
import ModernToolbar from './components/ModernToolbar';
import TabBar, { VIEW_TYPES } from './components/TabBar';
import TableView from './components/views/TableView';
import BlockDiagramView from './components/views/BlockDiagramView';
import PlaceholderView from './components/views/PlaceholderView';
import * as projectStore from './utils/projectStore.js';
import { initProjectRegistry, syncProjectRegistry, destroyProjectRegistry } from './utils/projectRegistry.js';
import ProjectBrowserDialog from './components/ProjectBrowserDialog.jsx';
import DiagramBrowserDialog from './components/DiagramBrowserDialog.jsx';

// デバッグログ（ブラウザコンソールで [RF-Debug] でフィルタ可能）
// 直近のイベントをリングバッファに保持し、デバッグ情報コピーに含める
const RF_DEBUG = true; // false にするとログ出力停止
const _rfDebugLog = [];           // リングバッファ
const RF_DEBUG_MAX_ENTRIES = 50;   // 保持する最大件数
const rfDebug = (...args) => {
  if (!RF_DEBUG) return;
  const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  const entry = { ts, msg: args[0], data: args[1] ?? null };
  _rfDebugLog.push(entry);
  if (_rfDebugLog.length > RF_DEBUG_MAX_ENTRIES) _rfDebugLog.shift();
  console.log('[RF-Debug]', ...args);
};

/* ── Yjs プロバイダー（プロジェクト切り替えで再初期化される） ── */
let _ydocInst      = null;
let _providerInst  = null;
let _wsProviderInst = null;
let _indexeddbInst = null;

function initYjsForProject(projectId) {
  try { _providerInst?.destroy();   } catch {}
  try { _wsProviderInst?.destroy(); } catch {}
  try { _indexeddbInst?.destroy();  } catch {}
  try { _ydocInst?.destroy();       } catch {}

  const roomName    = projectStore.getRoomName(projectId);
  _ydocInst         = new Y.Doc();
  _providerInst     = new WebrtcProvider(roomName, _ydocInst);
  try {
    _wsProviderInst = new WebsocketProvider(
      `ws://${window.location.hostname}:1234`, roomName, _ydocInst
    );
  } catch { _wsProviderInst = null; }
  _indexeddbInst    = new IndexeddbPersistence(roomName, _ydocInst);
  return _ydocInst;
}

// 起動時に初期化
let ydoc = new Y.Doc(); // Start with a dummy doc

// プロジェクトレジストリ初期化（MCPサーバーがプロジェクト一覧を取得するため）
initProjectRegistry(); // This is now fully async

// HMR時にYjsプロバイダーをクリーンアップ（開発モードの重複ルームエラー防止）
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    try { _providerInst?.destroy();   } catch {}
    try { _wsProviderInst?.destroy(); } catch {}
    try { _indexeddbInst?.destroy();  } catch {}
    destroyProjectRegistry();
    // ydoc は destroy しない（コンポーネントが参照中の可能性あり）
  });
}

const initialNodes = [];
const initialEdges = [];

function Flow() {
  const [nodes, setNodes, onNodesChangeState] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChangeState] = useEdgesState(initialEdges);
  const [isAutoLayout, setIsAutoLayout] = useState(true);
  const [projectName, setProjectName] = useState('New Project');
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [lastAddedNodeId, setLastAddedNodeId] = useState(null);
  const [isAddNodeMode, setIsAddNodeMode] = useState(false); // [B-028] ノード追加モード
  const [isEdgeMode, setIsEdgeMode] = useState(false); // [B-005] エッジ追加モード
  const [edgeSourceId, setEdgeSourceId] = useState(null); // [B-005] エッジの接続元ノードID
  const [hoveredNodeId, setHoveredNodeId] = useState(null); // [B-031] マウスオーバー中のノードID
  const [draggingNodeId, setDraggingNodeId] = useState(null); // [D-027] ドラッグ中のノードID
  const [focusMode, setFocusMode] = useState('none'); // [B-016] フォーカスモード
  const [isStructureMode, setIsStructureMode] = useState(false); // [修正] 「構成」モードの状態管理
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 }); // [B-031] ラバーバンド用マウス座標
  const [activeToolbarMenu, setActiveToolbarMenu] = useState(null); // ツールバーのサブメニュー管理
  const [ngContextMenu, setNgContextMenu] = useState(null); // ノードグラフ右クリックメニュー { x, y, nodeIds }

  // [D-027] ハイライト状態を安定させ、チャタリングを防ぐためのRef
  const lastTargetIdRef = React.useRef(null);
  const lastSourceIdRef = React.useRef(null);

  const clearHighlights = useCallback(() => {
    document.querySelectorAll('.drag-target-highlight')
      .forEach(el => el.classList.remove('drag-target-highlight'));
    lastTargetIdRef.current = null;
    lastSourceIdRef.current = null;
  }, []);

  // [修正] モードの切り替え（配置 ↔ 構成）をグローバルに監視
  useEffect(() => {
    const onKeyDown = (e) => { 
      if (e.key === 'Shift' && !e.repeat) {
        setIsStructureMode(true); 
      }
    };
    const onKeyUp = (e) => { 
      if (e.key === 'Shift') {
        setIsStructureMode(false); 
      } 
    };
    const onBlur = () => setIsStructureMode(false); // ウィンドウ切り替え時のスタック防止

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // [修正] モードが「構成」から外れたら即座に色をリセット
  useEffect(() => {
    if (!isStructureMode) clearHighlights();
  }, [isStructureMode, clearHighlights]);

  // [D-014] キーボードナビゲーションを有効化
  useKeyboardNavigation(ydoc, nodes, edges, setNodes);

  // [B-001] インライン編集と Markdown 同期を有効化
  useNodeEditor(ydoc);

  // Yjsの共有型（Map）を取得。IDをキーにすることで、個別の要素を効率的に同期できる
  const yNodes = ydoc.getMap('nodes');
  const yEdges = ydoc.getMap('edges');
  const yProjectMeta = ydoc.getMap('projectMeta'); // プロジェクト名などのメタデータ用

  const selectedNodeId = useMemo(() => nodes.find(n => n.selected)?.id, [nodes]);

  // [B-024] 視点同期（プレゼンテーションモード）を有効化
  const viewSync = useViewSync(yProjectMeta, ydoc.clientID, selectedNodeId);

  // [B-019] 単一テキストファイル入出力
  const { exportProject, importProject } = useFileIO(yNodes, yEdges, yProjectMeta, projectName);

  // nodeTypesをコンポーネント内でmemo化して参照を安定させる
  const nodeTypes = useMemo(() => ({
    custom: CustomNode,
    default: CustomNode,
  }), []);

  // [B-031] エッジタイプの登録
  const edgeTypes = useMemo(() => ({
    rubberband: RubberBandEdge,
  }), []);

  // 最新の状態を常に参照するためのRef (クロージャ問題と連打対策)
  const nodesRef = React.useRef(nodes);
  const edgesRef = React.useRef(edges);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  // 直前の選択状態を保持（左クリック時にReactFlowが選択を変更する前の状態を参照するため）
  const selectedNodeIdsRef = React.useRef([]);
  const prevSelectedNodeIdsRef = React.useRef([]);

  const { 
    setCenter, 
    getViewport, 
    fitView, 
    getIntersectingNodes, 
    getIntersectingEdges, 
    flowToScreenPosition,
    screenToFlowPosition 
  } = useReactFlow();

  // [B-031] グローバルなマウス移動ハンドラ
  const handleGlobalMouseMove = useCallback((event) => {
    viewSync.handleMouseMove(event);
    if (edgeSourceId) {
      setMousePos(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    }
  }, [edgeSourceId, screenToFlowPosition, viewSync]);

  // React FlowのPaneイベント用
  const onPaneMouseMove = useCallback((event) => {
    handleGlobalMouseMove(event);
  }, [handleGlobalMouseMove]);

  // デフォルトのエッジオプションを定義
  const defaultEdgeOptions = useMemo(() => ({
    animated: false, // 必要であればアニメーションを有効に
    style: { strokeWidth: 2, stroke: '#333' }, // エッジのスタイル
    markerEnd: {
      type: MarkerType.ArrowClosed, // 終端を閉じた矢印にする
      color: '#333', // 矢印の色
    },
  }), []);

  // UndoManagerの設定
  const undoManager = useMemo(() => new Y.UndoManager([yNodes, yEdges], {
    trackedOrigins: new Set(['local', 'structural']) // structuralオリジンの変更もUndo対象に含める
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
      // React Flow内部の状態を更新
      onNodesChangeState(changes);

      const hasStructuralChange = changes.some(c => c.type === 'remove');
      ydoc.transact(() => {
        changes.forEach((change) => {
          if (change.type === 'remove') {
            yNodes.delete(change.id);
          } else if (change.type === 'select') {
            // セレクションはローカルで完結させるため Yjs には書き込まない
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
      }, hasStructuralChange ? 'structural' : 'local');
    },
    [onNodesChangeState, yNodes, isAutoLayout] // setNodesを除去
  );

  // ノードを追加する関数（一番下に追加）
  const onAddNode = useCallback(() => {
    // フォーカス競合を防ぐため、現在の入力要素やノードからフォーカスを外す
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const id = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[Action] Adding normal node at bottom: ${id}`);

    // [D-004] 現在のノードの中で最大の Y 座標を取得して、そのさらに下に配置する
    const maxY = nodesRef.current.reduce((max, n) => Math.max(max, n.position.y), 0);
    
    const label = `Node ${yNodes.size + 1}`;
    const newNode = {
      id,
      type: 'custom',
      data: { label },
      position: { x: 0, y: maxY + 10 }, 
      selected: true,
      width: 180,
      height: 60,
    };

    const nextNodes = nodesRef.current.map(n => ({ ...n, selected: false })).concat(newNode);
    const nextEdges = edgesRef.current.map(e => ({ ...e, selected: false }));
    const finalNodes = isAutoLayout ? getLayoutedElements(nextNodes, nextEdges) : nextNodes;

    setNodes(finalNodes);
    setEdges(nextEdges);
    nodesRef.current = finalNodes;
    edgesRef.current = nextEdges;

    ydoc.transact(() => {
      yNodes.set(id, { ...newNode, selected: false });
    }, 'structural');

    setLastAddedNodeId(id);
  }, [yNodes, yEdges, setLastAddedNodeId, isAutoLayout, setNodes, setEdges]);

  // [B-029] ノードのクラスを一括更新する関数
  const onUpdateNodesClass = useCallback((className) => {
    const selectedNodes = nodesRef.current.filter(n => n.selected);
    if (selectedNodes.length === 0) return;

    // IDを保持しつつクラス名を除去するためのパターン
    const idPrefixRegex = /^(\[[A-Z0-9]+-\d+\]\s*)/i;
    const classPatternRegex = /^(?:\[[^\]]+\]|[^:：\s]+[:：])\s*/i;

    ydoc.transact(() => {
      selectedNodes.forEach(node => {
        const yNode = yNodes.get(node.id);
        if (!yNode) return;

        // ラベルから既存のクラス記法をクリーンアップ（IDは残す）
        const originalLabel = yNode.data.label || '';
        const idMatch = originalLabel.match(idPrefixRegex);
        const idPart = idMatch ? idMatch[1] : '';
        const labelWithoutId = originalLabel.substring(idPart.length);
        const cleanLabel = idPart + labelWithoutId.replace(classPatternRegex, '').trim();

        yNodes.set(node.id, {
          ...yNode,
          data: {
            ...yNode.data,
            nodeClass: className ? `node-class-${className.toLowerCase()}` : '',
            label: cleanLabel
          }
        });
      });
    }, 'structural');
    
    setActiveToolbarMenu(null); // メニューを閉じる
  }, [yNodes]);

  // [B-028] 構造的なノード追加（targetId指定に対応）
  const onAddStructuredNode = useCallback(
    (mode, targetId = null) => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;

      // ターゲットの特定（指定ID > 選択中 > 最後のノード）
      const baseNode = targetId
        ? currentNodes.find((n) => n.id === targetId)
        : currentNodes.find((n) => n.selected) || (currentNodes.length > 0 ? currentNodes[currentNodes.length - 1] : null);

      if (!baseNode) return;

      const nodeId = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // 選択ノードのクラスを継承
      const baseClass = baseNode.data?.nodeClass || '';

      let newNode = {
        id: nodeId,
        type: 'custom',
        data: { label: '', nodeClass: baseClass },
        position: { x: baseNode.position.x, y: baseNode.position.y },
        selected: true,
        width: 180,
        height: 60,
      };

      let edgesToAdd = [];
      let edgesToRemove = [];

      if (mode === 'child') {
        const childEdges = currentEdges.filter((e) => e.source === baseNode.id);
        const childNodes = currentNodes.filter((n) => childEdges.some((e) => e.target === n.id));
        const maxY = childNodes.reduce((max, n) => Math.max(max, n.position?.y || 0), baseNode.position.y - 70);
        
        newNode.data.label = 'New Node';
        newNode.position.x += 360;
        newNode.position.y = maxY + 70;
        edgesToAdd.push({ id: `edge-c-${Date.now()}`, source: baseNode.id, target: nodeId });
      } 
      else if (mode === 'sibling' || mode === 'sibling-above') {
        const parentEdges = currentEdges.filter(e => e.target === baseNode.id);
        const siblings = currentNodes.filter(n => currentEdges.some(e => parentEdges.some(pe => pe.source === e.source) && e.target === n.id));
        
        newNode.data.label = 'New Node';
        if (mode === 'sibling') {
          const maxY = siblings.reduce((max, n) => Math.max(max, n.position?.y || 0), baseNode.position.y);
          newNode.position.y = maxY + 70;
        } else {
          const minY = siblings.reduce((min, n) => Math.min(min, n.position?.y || 0), baseNode.position.y);
          newNode.position.y = minY - 70;
        }

        parentEdges.forEach((pe, idx) => {
          edgesToAdd.push({ id: `edge-s-${Date.now()}-${idx}`, source: pe.source, target: nodeId });
        });
      }
      else if (mode === 'parent') {
        newNode.data.label = 'New Node';
        newNode.position.x -= 360;
        
        const parentEdges = currentEdges.filter(e => e.target === baseNode.id);
        parentEdges.forEach(pe => {
          edgesToRemove.push(pe.id);
          edgesToAdd.push({ ...pe, id: `edge-p-in-${Date.now()}-${pe.id}`, target: nodeId });
        });
        
        edgesToAdd.push({ id: `edge-p-out-${Date.now()}`, source: nodeId, target: baseNode.id });
      }

      // [B-028] 即座にローカルステートに反映し、UXを向上
      const nextNodes = currentNodes.map(n => ({ ...n, selected: false })).concat(newNode);
      let nextEdges = currentEdges.map(e => ({ ...e, selected: false })).filter(e => !edgesToRemove.includes(e.id));
      edgesToAdd.forEach(edge => { nextEdges = addEdge(edge, nextEdges); });

      const finalNodes = isAutoLayout ? getLayoutedElements(nextNodes, nextEdges) : nextNodes;

      setNodes(finalNodes);
      setEdges(nextEdges);
      nodesRef.current = finalNodes;
      edgesRef.current = nextEdges;

      // Yjs共有ドキュメントへの永続化
      ydoc.transact(() => {
        yNodes.set(nodeId, { ...newNode, selected: false });
        edgesToRemove.forEach(id => yEdges.delete(id));
        edgesToAdd.forEach(edge => yEdges.set(edge.id, edge));
      }, 'structural');

      setLastAddedNodeId(nodeId);
    },
    [isAutoLayout, setLastAddedNodeId, setNodes, setEdges, yNodes, yEdges]
  );

  const onEdgesChange = useCallback(
    (changes) => {
      onEdgesChangeState(changes);
      const hasStructuralChange = changes.some(c => c.type === 'remove');
      ydoc.transact(() => {
        changes.forEach((change) => {
          if (change.type === 'remove') {
            yEdges.delete(change.id);
          } else if (change.type === 'select') {
          }
        });
      }, hasStructuralChange ? 'structural' : 'local');
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
      }, 'structural');
    },
    [yNodes, yEdges, isAutoLayout, setNodes, setEdges]
  );

  // [B-005] ノードクリック時のハンドラ
  const onNodeClick = useCallback((event, node) => {
    if (isAddNodeMode) {
      // [B-028] ノード追加モード時：クリックしたノードの子として追加
      onAddStructuredNode('child', node.id);
      setIsAddNodeMode(false);
    } else if (isEdgeMode) {
      event.preventDefault(); // React Flowのデフォルト選択動作を抑制
      event.stopPropagation(); // onPaneClickが発火するのを防ぐ

      ydoc.transact(() => {
        yNodes.forEach((n, id) => {
          if (n.isEdgeSourceCandidate) {
            yNodes.set(id, { ...n, isEdgeSourceCandidate: false });
          }
        });

        if (!edgeSourceId) {
          // 1回目のクリック: 接続元ノードとしてマーク
          yNodes.set(node.id, { ...yNodes.get(node.id), isEdgeSourceCandidate: true });
          setEdgeSourceId(node.id);
        } else {
          // 2回目のクリック: エッジを作成
          onConnect({ source: edgeSourceId, target: node.id });

          // [修正] 接続先（ターゲット）ノードを選択状態にする
          const targetNode = yNodes.get(node.id);
          if (targetNode) {
            yNodes.set(node.id, { ...targetNode, isEdgeSourceCandidate: false });
          }

          // [修正] 接続元（ソース）の候補フラグを確実に折る
          const sourceNode = yNodes.get(edgeSourceId);
          if (sourceNode) {
            yNodes.set(edgeSourceId, { ...sourceNode, isEdgeSourceCandidate: false });
          }

          setEdgeSourceId(null);
          setHoveredNodeId(null); // [B-031] ホバー状態をクリア
          setIsEdgeMode(false);
        }
      }, 'structural');
    }
  }, [isAddNodeMode, onAddStructuredNode, setIsAddNodeMode, isEdgeMode, edgeSourceId, yNodes, onConnect]);

  // [B-005] キャンバス（背景）クリック時のハンドラ
  const onPaneClick = useCallback(() => {
    setNgContextMenu(null);
    if (isAddNodeMode) {
      // [B-028] ノード追加モード時：背景クリックで一番下に追加
      onAddNode();
      setIsAddNodeMode(false);
    } else if (isEdgeMode) {
      if (edgeSourceId || isEdgeMode) {
        ydoc.transact(() => {
          yNodes.forEach((n, id) => {
            if (n.isEdgeSourceCandidate) yNodes.set(id, { ...n, isEdgeSourceCandidate: false });
          });
        }, 'structural');
        setEdgeSourceId(null);
        setHoveredNodeId(null); // [B-031] ホバー状態をクリア
        setIsEdgeMode(false);
      }
    }
  }, [isAddNodeMode, onAddNode, setIsAddNodeMode, isEdgeMode, edgeSourceId, yNodes]);

  // ── ノードグラフ右クリックメニュー ──
  const onNodeContextMenu = useCallback((event, node) => {
    event.preventDefault();
    const currentSelected = nodesRef.current.filter(n => n.selected);
    const prevIds = prevSelectedNodeIdsRef.current;
    rfDebug('onNodeContextMenu', { nodeId: node.id, currentSelected: currentSelected.map(n=>n.id), prevIds });
    let nodeIds;
    if (currentSelected.length >= 2) {
      nodeIds = currentSelected.map(n => n.id);
    } else if (prevIds.length >= 2 && prevIds.includes(node.id)) {
      nodeIds = prevIds;
    } else {
      nodeIds = [node.id];
    }
    rfDebug('→ setNgContextMenu', { nodeIds });
    setNgContextMenu({ x: event.clientX, y: event.clientY, nodeIds });
  }, []);

  // ── ペイン（背景）右クリック: 選択中ノードがあればメニュー表示 ──
  const onPaneContextMenu = useCallback((event) => {
    const selectedNodes = nodesRef.current.filter(n => n.selected);
    rfDebug('onPaneContextMenu', { selectedCount: selectedNodes.length, ids: selectedNodes.map(n=>n.id) });
    if (selectedNodes.length >= 1) {
      event.preventDefault();
      setNgContextMenu({ x: event.clientX, y: event.clientY, nodeIds: selectedNodes.map(n => n.id) });
    }
  }, []);

  // ── 複数選択時の右クリック（ReactFlowが複数選択時にonNodeContextMenuではなくこちらを発火） ──
  const onSelectionContextMenu = useCallback((event) => {
    event.preventDefault();
    const selectedNodes = nodesRef.current.filter(n => n.selected);
    rfDebug('onSelectionContextMenu', { selectedCount: selectedNodes.length, ids: selectedNodes.map(n=>n.id) });
    if (selectedNodes.length >= 1) {
      setNgContextMenu({ x: event.clientX, y: event.clientY, nodeIds: selectedNodes.map(n => n.id) });
    }
  }, []);

  // ── 選択変更追跡（左クリック前の選択状態を保持） ──
  const onSelectionChangeForMenu = useCallback(({ nodes: selNodes }) => {
    const prevIds = selectedNodeIdsRef.current;
    const newIds = selNodes.map(n => n.id);
    if (prevIds.length !== newIds.length || prevIds.some((id,i) => id !== newIds[i])) {
      rfDebug('onSelectionChange', { prev: prevIds, now: newIds });
    }
    prevSelectedNodeIdsRef.current = prevIds;
    selectedNodeIdsRef.current = newIds;
  }, []);

  // ── ノード左クリック: 複数選択中かつ通常モード時にもメニュー表示 ──
  const onNodeClickWithMenu = useCallback((event, node) => {
    const prev = prevSelectedNodeIdsRef.current;
    rfDebug('onNodeClick', { nodeId: node.id, isAddNodeMode, isEdgeMode, prevSelected: prev });
    if (isAddNodeMode || isEdgeMode) {
      onNodeClick(event, node);
      return;
    }
    if (prev.length >= 2 && prev.includes(node.id)) {
      rfDebug('→ left-click menu (multi-select)', { nodeIds: prev });
      setNgContextMenu({ x: event.clientX, y: event.clientY, nodeIds: prev });
      return;
    }
    onNodeClick(event, node);
  }, [isAddNodeMode, isEdgeMode, onNodeClick]);

  // ノードが追加された際に中央へ移動するエフェクト
  useEffect(() => {
    if (lastAddedNodeId) {
      const node = nodesRef.current.find((n) => n.id === lastAddedNodeId);
      if (node) {
        // 固定サイズ(180x60)の中心座標を計算
        const centerX = node.position.x + 90;
        const centerY = node.position.y + 30;

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

  // [S-034] 階層構造のコピー (Ctrl+C)
  const onCopyHierarchy = useCallback(() => {
    const selectedNode = nodesRef.current.find(n => n.selected);
    if (!selectedNode) return;

    const text = generateHierarchyText(nodesRef.current, edgesRef.current, selectedNode.id);
    navigator.clipboard.writeText(text);
    console.log('[Clipboard] Hierarchy copied to clipboard');
  }, []);

  // [S-032] 階層構造のペースト (Ctrl+V)
  const onPasteHierarchy = useCallback((text) => {
    try {
      if (!text || !text.trim()) return;

      const { nodes: pastedNodes, edges: pastedEdges } = parseHierarchyText(text);
      if (pastedNodes.length === 0) return;

      const selectedNode = nodesRef.current.find(n => n.selected);
      const timestamp = Date.now();

      ydoc.transact(() => {
        // 1. 各ノードを登録
        pastedNodes.forEach(node => {
          yNodes.set(node.id, {
            ...node,
            width: 180,
            height: 60,
            selected: false,
            position: { x: (selectedNode?.position.x || 0) + 360, y: node.position.y }
          });
        });

        // 2. 内部の親子関係を登録
        pastedEdges.forEach(edge => yEdges.set(edge.id, edge));

        // 3. ペーストされたツリーのルートを現在の選択ノードに接続
        const pastedNodeIds = new Set(pastedNodes.map(n => n.id));
        const pastedRoots = pastedNodes.filter(n => !pastedEdges.some(e => e.target === n.id));
        
        if (selectedNode) {
          pastedRoots.forEach((root, idx) => {
            const edgeId = `edge-paste-link-${timestamp}-${idx}`;
            yEdges.set(edgeId, { id: edgeId, source: selectedNode.id, target: root.id });
          });
        }

        // 4. ペーストされた最初のノードを選択状態にする（ローカル）
        setNodes(nds => nds.map(n => ({
          ...n,
          selected: n.id === pastedNodes[0].id
        })));
        setLastAddedNodeId(pastedNodes[0].id);

      }, 'structural');
      console.log(`[Clipboard] Pasted ${pastedNodes.length} nodes from clipboard`);
    } catch (err) {
      console.error('[Clipboard] Failed to paste:', err);
    }
  }, [yNodes, yEdges, isAutoLayout, setNodes, setLastAddedNodeId]);

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
    }, 'structural');
  }, [yNodes, yEdges]);

  // [D-027] ノード直接移動（Drag-and-Drop Re-parenting）のハンドラ
  const onNodeDragStart = useCallback((event, node) => {
    setDraggingNodeId(node.id);
  }, [setDraggingNodeId]);

  const onNodeDrag = useCallback((event, node) => {
    const currentMode = isStructureMode || event.shiftKey;
    if (!currentMode) {
      // 配置モード (Layout Mode)
      if (lastSourceIdRef.current || lastTargetIdRef.current) clearHighlights();

      // [D-029] ライブ・ローカルレイアウト
      if (isAutoLayout) {
        const tempNodes = nodesRef.current.map(n => 
          n.id === node.id ? { ...n, position: node.position } : n
        );
        
        // 論理的な配置を計算
        const layouted = getLayoutedElements(tempNodes, edgesRef.current);

        if (layouted) {
          // ドラッグ中の本人以外を計算後の位置に動かす（本人はマウスに追従）
          setNodes(layouted.map(n => 
            n.id === node.id ? { ...n, position: node.position } : n
          ));

          // [B-024] プレゼンターの場合は、避けるノードの動きも他ユーザーへ同期
          if (viewSync.isPresenter) {
            ydoc.transact(() => {
              layouted.forEach(n => {
                const yNode = yNodes.get(n.id);
                // 位置が実際に変わっているノードのみ更新
                if (yNode && (Math.abs(yNode.position.x - n.position.x) > 0.5 || Math.abs(yNode.position.y - n.position.y) > 0.5)) {
                  yNodes.set(n.id, { ...yNode, position: n.position });
                }
              });
            }, 'local'); // local origin で送信（自分側での再レイアウトを抑制）
          }
        }
      }
      return;
    }
    
    const nodeWithDimensions = {
      ...node,
      width: node.width || 180,
      height: node.height || 60,
    };

    // 2. ターゲット（重ね先）の判定
    const intersections = getIntersectingNodes(nodeWithDimensions, true);
    const targetNode = intersections.find(n => n.id !== node.id && !isDescendant(nodesRef.current, edgesRef.current, node.id, n.id));
    const targetId = targetNode?.id || null;
    
    // ターゲットが前回と異なる場合のみ DOM を更新（チャタリング防止）
    if (targetId !== lastTargetIdRef.current) {
      // 旧ハイライト消去
      if (lastTargetIdRef.current) {
        const oldEl = document.querySelector(`[data-id="${lastTargetIdRef.current}"]`) || 
                      document.querySelector(`[data-testid="rf__edge-${lastTargetIdRef.current}"]`);
        oldEl?.classList.remove('drag-target-highlight');
      }
      
      // 新ハイライト適用
      if (targetId) {
        const newEl = document.querySelector(`[data-id="${targetId}"]`);
        newEl?.classList.add('drag-target-highlight');
        lastTargetIdRef.current = targetId;
      } else if (typeof getIntersectingEdges === 'function') {
        const edgeIntersections = getIntersectingEdges(nodeWithDimensions, true);
        const targetEdge = edgeIntersections?.[0];
        if (targetEdge) {
          const edgeEl = document.querySelector(`[data-testid="rf__edge-${targetEdge.id}"]`);
          edgeEl?.classList.add('drag-target-highlight');
          lastTargetIdRef.current = targetEdge.id;
        } else {
          lastTargetIdRef.current = null;
        }
      } else {
        lastTargetIdRef.current = null;
      }
    }
  }, [getIntersectingNodes, getIntersectingEdges, nodesRef, edgesRef, clearHighlights, isStructureMode]);

  const onNodeDragStop = useCallback((event, node) => {
    setDraggingNodeId(null);
    clearHighlights(); // ドロップ時に必ずハイライトをリセット

    // [重要] 構造変更の確定判断も管理下のステートに寄せる
    const isStructuralChange = isStructureMode;

    // [修正] ドラッグ停止時は、現在の全ノードの座標を「確定値」として保存するために structural を使用
    // これにより、手動モードでの座標が選択変更時にリセットされるのを防ぐ
    const origin = 'structural';

    // [修正] nodeオブジェクトに確実に寸法を持たせてから交差判定を行う
    const nodeWithDimensions = {
      ...node,
      width: node.width || 180,
      height: node.height || 60,
    };

    // [修正] 第二引数に true を渡し、一部でも重なれば検知するようにする
    const intersections = isStructuralChange ? getIntersectingNodes(nodeWithDimensions, true) : [];

    // 自分自身や自分の子孫でないノードをターゲットにする
    const targetNode = intersections.find(n => n.id !== node.id && !isDescendant(nodesRef.current, edgesRef.current, node.id, n.id));

    // [D-029] 最終的な論理配置を再計算して、全ノードの座標を確定させる準備
    const tempNodes = nodesRef.current.map(n => 
      n.id === node.id ? { ...n, position: node.position } : n
    );

    // [D-029] レイアウト結果を取得（ONなら計算値、OFFなら現在の移動後ステート）
    const finalLayout = isAutoLayout 
      ? getLayoutedElements(tempNodes, edgesRef.current) 
      : tempNodes;

    ydoc.transact(() => {
      // [B-003] ドラッグ終了時は、全ノードの「現在の画面上の座標」を Yjs に保存する
      // これにより、手動モードへ移行した際や、選択変更時に位置が戻るのを防ぐ
      finalLayout.forEach(layoutedNode => {
        const yNode = yNodes.get(layoutedNode.id);
        if (yNode) {
          // 座標を上書きして固定
          yNodes.set(layoutedNode.id, { 
            ...yNode, 
            position: { x: layoutedNode.position.x, y: layoutedNode.position.y } 
          });
        }
      });

      // [S-028] Shiftキーが押されている場合のみ構造変更を実行
      if (isStructuralChange) {
        if (targetNode) {
        // [D-027] ノードへのドロップ: 新しい親にする
        const currentEdges = Array.from(yEdges.values()).filter(Boolean);
        const existingParentEdges = currentEdges.filter(e => e.target === node.id);
        
        // ドロップ先が現在の親でない場合のみエッジを張り替える
        if (!existingParentEdges.some(e => e.source === targetNode.id)) {
          // 全ての既存の親との接続を削除
          existingParentEdges.forEach(e => yEdges.delete(e.id));
          
          const newEdgeId = `edge-dnd-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          const newEdge = { 
            id: newEdgeId, 
            source: targetNode.id, 
            target: node.id,
            sourceHandle: null,
            targetHandle: null 
          };
          yEdges.set(newEdgeId, newEdge);

          // 自動レイアウト時の順序ヒント: 兄弟リストの末尾に配置
          if (isAutoLayout) {
            const siblings = currentEdges
              .filter(e => e.source === targetNode.id && e.target !== node.id)
              .map(e => yNodes.get(e.target))
              .filter(Boolean);
            const maxY = siblings.reduce((max, n) => Math.max(max, n.position?.y || 0), 0);
            yNodes.set(node.id, { ...yNode, position: { x: node.position.x, y: maxY + 1 } });
          }
        }
      } else {
        // ノードへのドロップがない場合、エッジへのドロップを確認
        const edgeIntersections = typeof getIntersectingEdges === 'function' ? getIntersectingEdges(nodeWithDimensions, true) : [];
        if (edgeIntersections.length > 0) {
          const targetEdge = edgeIntersections[0];

          // 自分の子孫を含むエッジへの割り込みは禁止（サイクル防止）
          if (isDescendant(nodesRef.current, edgesRef.current, node.id, targetEdge.source)) return;
          // 自分の直属のエッジには割り込めない
          if (targetEdge.source === node.id || targetEdge.target === node.id) return;

          const currentEdges = Array.from(yEdges.values()).filter(Boolean);
          const existingParentEdges = currentEdges.filter(e => e.target === node.id);

          // 全ての既存の親との接続を削除
          existingParentEdges.forEach(e => yEdges.delete(e.id));

          // 既存エッジを削除して間に挟む
          const { source: sourceId, target: targetId } = targetEdge;
          yEdges.delete(targetEdge.id);
          
          const e1Id = `edge-dnd-pre-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          const e2Id = `edge-dnd-post-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          
          yEdges.set(e1Id, { id: e1Id, source: sourceId, target: node.id, sourceHandle: null, targetHandle: null });
          yEdges.set(e2Id, { id: e2Id, source: node.id, target: targetId, sourceHandle: null, targetHandle: null });

          // 自動レイアウトのヒントとしてターゲットノードの座標を参考に設定
          const targetNodeObj = nodesRef.current.find(n => n.id === targetId);
          if (isAutoLayout && targetNodeObj) {
            yNodes.set(node.id, { ...yNode, position: { x: node.position.x, y: targetNodeObj.position.y - 0.5 } });
          }
        } else {
          // 空きスペースへのドロップ時は、座標の保存のみ行われ、自動レイアウトにより順序が更新される
        }
      }
      }
    }, 'structural');
  }, [getIntersectingNodes, getIntersectingEdges, isAutoLayout, yNodes, yEdges, yProjectMeta, nodesRef, edgesRef, isStructureMode, clearHighlights]);


  // レイアウトデバッグ情報をクリップボードにコピーする関数
  const onCopyDebugInfo = useCallback(() => {
    const selectedNodes = nodesRef.current.filter(n => n.selected);
    const selectedEdges = edgesRef.current.filter(e => e.selected);
    const isFiltering = selectedNodes.length > 0;
    const nodesToExport = isFiltering ? selectedNodes : nodesRef.current;
    const exportedNodeIds = new Set(nodesToExport.map(n => n.id));

    const debugInfo = {
      timestamp: new Date().toISOString(),
      project: projectName,
      isAutoLayout,
      selection: {
        nodeCount: selectedNodes.length,
        nodeIds: selectedNodes.map(n => n.id),
        edgeCount: selectedEdges.length,
      },
      totalNodes: nodesRef.current.length,
      totalEdges: edgesRef.current.length,
      nodes: nodesToExport.map(n => ({ 
        id: n.id, 
        label: n.data?.label,
        nodeClass: n.data?.nodeClass,
        selected: n.selected ?? false,
        x: Math.round(n.position.x), 
        y: Math.round(n.position.y) 
      })),
      edges: edgesRef.current
        .filter(e => exportedNodeIds.has(e.source) && exportedNodeIds.has(e.target))
        .map(e => ({ source: e.source, target: e.target, selected: e.selected ?? false })),
      recentEvents: _rfDebugLog.slice(-20),
    };
    const text = JSON.stringify(debugInfo, null, 2);
    navigator.clipboard.writeText(text);
    alert(isFiltering
      ? `選択中の要素(${selectedNodes.length}ノード)のデバッグ情報をコピーしました。\n直近${Math.min(_rfDebugLog.length,20)}件のイベント履歴を含みます。`
      : `全要素のデバッグ情報をコピーしました。\n直近${Math.min(_rfDebugLog.length,20)}件のイベント履歴を含みます。`);
  }, [isAutoLayout, projectName]);

  // キーボードショートカットの制御
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 入力フォーム等にフォーカスがある場合は無視
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (['Enter', 'Insert', 'Delete', 'z', 'y'].includes(e.key)) console.log(`[Keyboard] Key pressed: ${e.key}`);
      
      // [B-022] Copy/Paste Hierarchy
      if (e.ctrlKey && e.key === 'c') {
        // 入力要素にフォーカスがある場合は標準のコピーを許可
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        e.preventDefault();
        onCopyHierarchy();
      }

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
        if (e.shiftKey) {
          onAddStructuredNode('parent');
        } else {
          onAddStructuredNode('child');
        }
      }
      // 兄弟ノード追加: Enter (下) / Shift + Enter (上)
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          onAddStructuredNode('sibling-above');
        } else {
          onAddStructuredNode('sibling');
        }
      }
      // 削除: Delete (既存の削除ボタン機能を呼び出し)
      if (e.key === 'Delete') {
        onDeleteSelected();
      }

      // [B-016] フォーカスモード切り替え: F
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setFocusMode(prev => {
          if (prev === 'none') return 'both';
          if (prev === 'both') return 'upstream';
          if (prev === 'upstream') return 'downstream';
          return 'none';
        });
      }

      // [B-005] Escapeキーでエッジ追加モードを解除
      if (e.key === 'Escape') {
        // クラス設定メニュー等のサブメニューを閉じる
        setActiveToolbarMenu(null);

        if (isAddNodeMode || isEdgeMode) {
          e.preventDefault();
          setIsAddNodeMode(false);
          ydoc.transact(() => {
            yNodes.forEach((n, id) => { if (n.isEdgeSourceCandidate) yNodes.set(id, { ...n, isEdgeSourceCandidate: false }); });
          }, 'structural');
          setEdgeSourceId(null);
        setHoveredNodeId(null); // [B-031] ホバー状態をクリア
          setIsEdgeMode(false);
        }
      }
    };

    const handlePaste = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      e.preventDefault();
      const text = e.clipboardData.getData('text');
      onPasteHierarchy(text);
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste);
    };
  }, [undoManager, onAddStructuredNode, onDeleteSelected, onCopyHierarchy, onPasteHierarchy, isAddNodeMode, setIsAddNodeMode, isEdgeMode, edgeSourceId, yNodes, setIsEdgeMode, setEdgeSourceId, setFocusMode, setActiveToolbarMenu]);

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
      // [修正] 以前は local origin を無視していましたが、ラベル編集による nodeClass の
      // 再計算を自分自身の画面でも即座に反映させるため、常に同期を実行します。
      // React Flow の setNodes はデータに変更がない限り再レンダリングを抑制するため、
      // ここでの early return は不要です。
      
      const nodesArray = Array.from(yNodes.values());
      const edgesArray = Array.from(yEdges.values());
      const yjsName = yProjectMeta.get('name');
      if (yjsName) {
        setProjectName(yjsName);
        // Yjs→localStorage同期 (MCP等の外部からの名前変更を反映)
        PS.renameProject(PS.getActiveProjectId(), yjsName);
      }

      // [B-016] フォーカス対象（到達可能セット）の算出
      const focusSet = (focusMode === 'none') ? null : (() => {
        const selected = nodesArray.find(n => n.selected) || nodesRef.current.find(n => n.selected);
        if (!selected) return null;
        const nodeIds = new Set([selected.id]);
        const edgeIds = new Set();
        const adjF = {}; const adjB = {};
        edgesArray.forEach(e => {
          if (!adjF[e.source]) adjF[e.source] = []; adjF[e.source].push({t: e.target, id: e.id});
          if (!adjB[e.target]) adjB[e.target] = []; adjB[e.target].push({s: e.source, id: e.id});
        });
        const trav = (id, adj, dir) => {
          const q = [id]; const v = new Set([id]);
          while(q.length) {
            const c = q.pop();
            (adj[c] || []).forEach(edge => {
              const n = dir === 'f' ? edge.t : edge.s;
              if(!v.has(n)){ v.add(n); nodeIds.add(n); q.push(n); }
              edgeIds.add(edge.id);
            });
          }
        };
        if(focusMode === 'downstream' || focusMode === 'both') trav(selected.id, adjF, 'f');
        if(focusMode === 'upstream' || focusMode === 'both') trav(selected.id, adjB, 'b');
        return {nodeIds, edgeIds};
      })();

      const nextNodes = nodesArray.map((yNode) => {
        // [B-007/017] ラベルからクラス名を動的に解析 (再読み込み時の再現性を向上)
        const label = (yNode.data?.label || '').trim();
        const classRegex = /^(?:\[[A-Z0-9]+-\d+\]\s*)?(?:\[([^\]]+)\]|([^:：\s]+)[:：\s])/i;
        const match = label.match(classRegex);
        
        // [修正] NodeやChildなどの汎用ワードはクラスとして扱わない
        const parsedClassName = match ? (match[1] || match[2]).toLowerCase().trim() : '';
        const isGeneric = ['node', 'child', 'default'].includes(parsedClassName);

        // [D-044] 属性優先ロジック: 
        // UIから設定された nodeClass (属性) があればそれを最優先し、なければラベルから解析する
        const attrClass = yNode.data?.nodeClass;
        const nodeClass = (attrClass && attrClass !== '') 
          ? attrClass 
          : (match && !isGeneric ? `node-class-${parsedClassName}` : '');

        const localNode = nodesRef.current.find(n => n.id === yNode.id);
        return {
          ...yNode,
          width: 180,
          height: 60,
          selected: localNode ? localNode.selected : false, // ローカルの選択状態を優先
          hidden: focusSet ? !focusSet.nodeIds.has(yNode.id) : false,
          data: { 
            ...yNode.data, 
            nodeClass, // 解析済みクラス名を付与
            isEdgeSourceCandidate: !!yNode.isEdgeSourceCandidate,
            isPresenterSelected: yNode.id === viewSync.remoteSelectedNodeId
          }
        };
      });

      const nextEdges = edgesArray.map(e => {
        const localEdge = edgesRef.current.find(ee => ee.id === e.id);
        return {
        ...e,
        selected: localEdge ? localEdge.selected : false,
        hidden: focusSet ? !focusSet.edgeIds.has(e.id) : false
        };
      });

      // [デバッグ] 同期状態のログ出力
      const isSyncingView = viewSync.isFollowing;
      // 視点追従中 (isFollowing) は、自身の自動レイアウト設定に関わらず、配信元の座標を優先する
      const shouldComputeLayout = isAutoLayout && !isSyncingView;

      const finalNodes = (shouldComputeLayout && nextNodes.length > 0)
        ? getLayoutedElements(nextNodes, nextEdges)
        : nextNodes;

      setNodes(finalNodes);
      setEdges(nextEdges);
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
  }, [yNodes, yEdges, yProjectMeta, setNodes, setEdges, isAutoLayout, edgeSourceId, focusMode, selectedNodeId, viewSync.isFollowing, viewSync.remoteSelectedNodeId]); // remoteSelectedNodeId を追加

  // [B-031] 表示用エッジの計算 (確定済みのエッジ + ラバーバンド)
  const displayEdges = useMemo(() => {
    if (!edgeSourceId) {
      return edges;
    }

    // ホバー中のノードがあり、それが接続元ノードと異なる場合
    if (hoveredNodeId && hoveredNodeId !== edgeSourceId) {
      return [
        ...edges,
        {
          id: 'temp-connecting-edge',
          source: edgeSourceId,
          target: hoveredNodeId,
          type: 'default', // デフォルトエッジでノードにスナップ
          animated: true,
          style: { strokeWidth: 2, stroke: '#3b82f6', strokeDasharray: '5 5' },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#3b82f6',
          },
        },
      ];
    } else {
      // ホバー中のノードがない、または接続元ノード自身にホバーしている場合
      return [
        ...edges,
        {
          id: 'rubber-band-edge',
          source: edgeSourceId,
          target: edgeSourceId, // カスタムエッジをレンダリングさせるためのダミーターゲット
          type: 'rubberband',
          data: { mousePos },
          animated: true,
        },
      ];
    }
  }, [edges, edgeSourceId, hoveredNodeId, mousePos]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        .react-flow__edge.selected .react-flow__edge-path {
          stroke: #ff0000 !important;
          stroke-width: 3;
        }
        /* [B-031] ラバーバンドエッジのスタイル */
        .rubber-band-edge-path {
          stroke: #3b82f6 !important;
          stroke-dasharray: 5 5;
          opacity: 0.6;
          pointer-events: none;
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
        .btn-icon:hover {
          background-color: #f8fafc !important;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        /* [B-028] アクティブなボタンの反転表示 */
        .btn-icon.active {
          background-color: var(--active-bg) !important;
          color: #ffffff !important;
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
        }
        .btn-icon svg {
          width: 20px;
          height: 20px;
        }
        /* 通常時のノードスタイル */
        .custom-node {
          position: relative !important;
          overflow: visible !important;
          box-sizing: border-box;
          border: 1px solid #777;
          background-color: #ffffff;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        /* 選択時の強調（赤枠） */
        .custom-node.selected {
          border: 2px solid #ff4d4d !important;
          box-shadow: 0 0 10px rgba(255, 77, 77, 0.5) !important;
        }
        /* ノードクラス・バッジのスタイル */
        .node-class-badge {
          position: absolute !important;
          top: -12px !important;
          right: 10px !important;
          background-color: #3b82f6 !important;
          color: white !important;
          font-size: 10px !important;
          font-weight: bold !important;
          padding: 2px 6px !important;
          border-radius: 4px !important;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
          z-index: 100 !important;
          white-space: nowrap !important;
        }
        /* エッジ接続元の候補（青枠） */
        .custom-node.edge-source-candidate {
          border: 3px solid #3b82f6 !important;
          box-shadow: 0 0 15px rgba(59, 130, 246, 0.6) !important;
        }
        /* プレゼンターの選択（緑枠） */
        .custom-node.presenter-selected {
          border: 3px solid #22c55e !important;
          background-color: #f0fdf4 !important;
          box-shadow: 0 0 10px rgba(34, 197, 94, 0.5) !important;
        }
        /* [B-028] モード中のホバー強調（選択候補） */
        .selectable-mode-active .custom-node:hover:not(.edge-source-candidate) {
          background-color: #f0f9ff !important;
          border: 2px solid #0ea5e9 !important;
          box-shadow: 0 0 12px rgba(14, 165, 233, 0.4) !important;
        }
        /* [D-027] ドラッグターゲットのハイライト */
        .drag-target-highlight {
          box-shadow: 0 0 0 4px #3b82f6 !important;
          border-color: #3b82f6 !important;
          stroke: #3b82f6 !important;
        }
        /* 構成モード時にドラッグしている本人のスタイルを上書き（薄い赤） */
        .structure-mode-active .react-flow__node.dragging .custom-node {
          background: #fffafa !important;
          border: 2px solid #feb2b2 !important;
          box-shadow: 0 0 10px rgba(254, 178, 178, 0.4) !important;
        }

        /* [D-043] ノードクラス別カラーマッピング (背景色を少し濃くして視認性を向上) */
        /* 強力な詳細度を確保するため、属性セレクタとクラスを組み合わせる */
        div.custom-node[class*="node-class-requirement"] { background-color: #fef3c7 !important; border-color: #f59e0b !important; }
        div.custom-node[class*="node-class-spec"] { background-color: #e0f2fe !important; border-color: #0ea5e9 !important; }
        div.custom-node[class*="node-class-design"] { background-color: #dcfce7 !important; border-color: #22c55e !important; }
        div.custom-node[class*="node-class-issue"] { background-color: #ffe4e6 !important; border-color: #e11d48 !important; }

        /* [D-043] クラス別バッジカラーのマッピング */
        div.custom-node[class*="node-class-requirement"] .node-class-badge { background-color: #f59e0b !important; }
        div.custom-node[class*="node-class-spec"] .node-class-badge { background-color: #0ea5e9 !important; }
        div.custom-node[class*="node-class-design"] .node-class-badge { background-color: #22c55e !important; }
        div.custom-node[class*="node-class-issue"] .node-class-badge { background-color: #e11d48 !important; }
        div.custom-node[class*="node-class-db"] .node-class-badge { background-color: #475569 !important; }
        div.custom-node[class*="node-class-process"] .node-class-badge { background-color: #6366f1 !important; }

        /* 形状マッピング */
        .custom-node.node-class-db { 
          border-style: double !important; 
          border-width: 4px !important; 
        }
        .custom-node.node-class-process { 
          border-radius: 20px !important; 
        }
        
        /* ホバー時の挙動（クラス付きノードでも優先順位を維持） */
        .selectable-mode-active .custom-node[class*="node-class-"]:hover {
          background-color: #f0f9ff !important;
          border: 2px solid #0ea5e9 !important;
          border-style: solid !important; /* DBなどの特殊形状もホバー時は一時的に戻す */
        }

        /* クラスセレクター・メニューのスタイル */
        .toolbar-menu-popout {
          position: absolute;
          right: 50px;
          top: 0;
          background: #ffffff;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          display: flex;
          flex-direction: row;
          padding: 4px;
          gap: 4px;
          box-shadow: -4px 0 15px rgba(0,0,0,0.1);
          z-index: 1002;
          animation: slideIn 0.2s ease-out;
        }
        @keyframes slideIn {
          from { transform: translateX(10px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
      <div onMouseMove={handleGlobalMouseMove} style={{ width: '100%', height: '100%' }}>
        <ReactFlow
        className={`${isStructureMode ? 'structure-mode-active' : ''} ${isAddNodeMode || isEdgeMode ? 'selectable-mode-active' : ''}`}
        nodes={nodes}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClickWithMenu}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onSelectionContextMenu={onSelectionContextMenu}
        onSelectionChange={onSelectionChangeForMenu}
        onPaneClick={onPaneClick} // [B-005] キャンバスクリックハンドラを追加
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onMove={viewSync.handleMove}
        onNodeMouseEnter={useCallback((event, node) => { if (isEdgeMode && edgeSourceId && node.id !== edgeSourceId) setHoveredNodeId(node.id); }, [isEdgeMode, edgeSourceId])}
        onNodeMouseLeave={useCallback((event, node) => { if (hoveredNodeId === node.id) setHoveredNodeId(null); }, [hoveredNodeId])}
        onPaneMouseMove={onPaneMouseMove}
        onConnect={onConnect}
        style={{ cursor: (isAddNodeMode || isEdgeMode) ? 'crosshair' : 'inherit' }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        // [S-028] 常にドラッグ自体は可能にする（自動レイアウト時はShift+ドラッグで構造編集するため）
        nodesDraggable={true} 
        zoomOnDoubleClick={false}
        // [S-042/D-047] 操作体系の最適化 (Lucidchart 方式)
        panOnDrag={[1, 2]} 
        selectionOnDrag={true} 
        selectionMode={SelectionMode.Partial} 
        fitView
      >
        <Background />
        <Controls />
        </ReactFlow>

        {/* [D-039] データ駆動型ツールバー構成 - フローティングUIのためReactFlowの外に配置 */}
        {(() => {
          const toolbarConfig = [
            {
              id: 'undo',
              tooltip: '元に戻す (Ctrl+Z)',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>,
              onClick: () => undoManager.undo(),
              disabled: !canUndo
            },
            {
              id: 'redo',
              tooltip: 'やり直し (Ctrl+Y)',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>,
              onClick: () => undoManager.redo(),
              disabled: !canRedo
            },
            { id: 'sep1', type: 'divider' },
            {
              id: 'addnode',
              tooltip: isAddNodeMode ? '追加先を選択（背景なら一番下、ノードなら子）' : 'ノード追加モード開始',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19,3H5C3.9,3 3,3.9 3,5V19C3,20.1 3.9,21 5,21H19C20.1,21 21,20.1 21,19V5C21,3.9 20.1,3 19,3M19,19H5V5H19V19Z"/></svg>,
              onClick: () => {
                const nextMode = !isAddNodeMode;
                setIsAddNodeMode(nextMode);
                if (nextMode) {
                  setIsEdgeMode(false);
                  setEdgeSourceId(null);
                  setHoveredNodeId(null);
                  ydoc.transact(() => {
                    yNodes.forEach((n, id) => { if (n.isEdgeSourceCandidate) yNodes.set(id, { ...n, isEdgeSourceCandidate: false }); });
                  }, 'structural');
                }
              },
              active: isAddNodeMode,
              activeColor: '#10b981'
            },
            {
              id: 'edgemode',
              tooltip: !isEdgeMode ? "エッジ追加モード開始" : (edgeSourceId ? "接続先を選択してください" : "接続元を選択してください"),
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13,7V10H5V14H13V17L18,12L13,7Z"/></svg>,
              onClick: () => {
                const nextMode = !isEdgeMode;
                setIsEdgeMode(nextMode);
                if (nextMode) setIsAddNodeMode(false);
                setEdgeSourceId(null);
                setHoveredNodeId(null);
                ydoc.transact(() => {
                  yNodes.forEach((n, id) => { if (n.isEdgeSourceCandidate) yNodes.set(id, { ...n, isEdgeSourceCandidate: false }); });
                }, 'structural');
              },
              active: isEdgeMode,
              activeColor: '#3b82f6'
            },
            {
              id: 'delete',
              tooltip: '選択要素を削除',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>,
              onClick: onDeleteSelected,
              style: { color: '#ef4444' }
            },
            { id: 'sep2', type: 'divider' },
            {
              id: 'class-selector',
              tooltip: '属性（クラス）を一括設定',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.86L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/></svg>,
              onClick: () => setActiveToolbarMenu(activeToolbarMenu === 'class' ? null : 'class'),
              active: activeToolbarMenu === 'class',
              component: (props) => (
                <div className={props.className} style={{ position: 'relative' }}>
                  <button className="btn-icon" onClick={props.onClick} data-tooltip={props.tooltip} style={{ ...props.style, border: 'none', background: 'transparent', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'inherit' }}>{props.icon}</button>
                  {activeToolbarMenu === 'class' && (
                    <div className="toolbar-menu-popout">
                      {['Requirement', 'Spec', 'Design', 'Issue', 'DB', 'Process', ''].map(cls => {
                        const classColors = {
                          Requirement: '#f59e0b',
                          Spec: '#0ea5e9',
                          Design: '#22c55e',
                          Issue: '#e11d48',
                          DB: '#475569',
                          Process: '#6366f1',
                          '': '#ffffff'
                        };
                        const color = classColors[cls];
                        return (
                          <button 
                            key={cls} 
                            className={`btn-icon-small ${cls ? `node-class-${cls.toLowerCase()}` : ''}`} 
                            onClick={(e) => { e.stopPropagation(); onUpdateNodesClass(cls); }} 
                            data-tooltip={cls ? `${cls}クラスを適用` : 'クラスを解除'} 
                            style={{ 
                              width: '32px', 
                              height: '32px', 
                              fontSize: '11px', 
                              fontWeight: 'bold', 
                              border: '1px solid #ddd', 
                              borderRadius: '4px',
                              cursor: 'pointer', 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center', 
                              background: color,
                              color: cls ? '#fff' : '#666',
                              transition: 'transform 0.1s'
                            }}
                          >
                            {cls ? cls[0] : '✕'}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )
            },
            {
              id: 'reset',
              tooltip: '全リセット',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>,
              onClick: onReset,
              style: { color: '#ef4444' }
            },
            { id: 'sep3', type: 'divider' },
            {
              id: 'autolayout',
              tooltip: isAutoLayout ? "自動レイアウト解除" : "自動レイアウト適用",
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.5 5.6L10 7L8.6 4.5L10 2L7.5 3.4L5 2L6.4 4.5L5 7L7.5 5.6ZM19.5 15.4L17 14L18.4 16.5L17 19L19.5 17.6L22 19L20.6 16.5L22 14L19.5 15.4ZM22 2L19.5 3.4L17 2L18.4 4.5L17 7L19.5 5.6L22 7L20.6 4.5L22 2ZM14.1 5.9L3 17L7 21L18.1 9.9L14.1 5.9ZM16.6 7.4L14.6 5.4L15.9 4.1L17.9 6.1L16.6 7.4Z"/></svg>,
              onClick: () => setIsAutoLayout(!isAutoLayout),
              active: isAutoLayout,
              activeColor: '#6366f1'
            },
            {
              id: 'focus',
              tooltip: `フォーカスモード: ${focusMode}`,
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm-7 7H3v4c0 1.1.9 2 2 2h4v-2H5v-4zM5 5h4V3H5c-1.1 0-2 .9-2 2v4h2V5zm14-2h-4v2h4v4h2V5c0-1.1-.9-2-2-2zm0 16h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4z"/></svg>,
              onClick: () => setFocusMode(prev => (prev === 'none' ? 'both' : prev === 'both' ? 'upstream' : prev === 'upstream' ? 'downstream' : 'none')),
              active: focusMode !== 'none',
              activeColor: '#8b5cf6'
            },
            { id: 'sep4', type: 'divider' },
            {
              id: 'import',
              tooltip: 'プロジェクト・インポート',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>,
              component: (props) => (
                <label className="btn-icon" {...props} style={{ cursor: 'pointer' }}>
                  {props.icon}
                  <input type="file" accept=".md" onChange={(e) => importProject(e.target.files[0])} style={{ display: 'none' }} />
                </label>
              )
            },
            {
              id: 'export',
              tooltip: 'プロジェクト・エクスポート',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 20h14v-2H5v2zM19 11l-7-7-7 7h4v6h6v-6h4z"/></svg>,
              onClick: exportProject
            },
            { id: 'sep5', type: 'divider' },
            {
              id: 'debug',
              tooltip: 'デバッグ情報コピー',
              icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v2H7v-2zm0 4h2v2H7v-2zm0-8h2v2H7V6zm4 4h6v2h-6v-2zm0 4h6v2h-6v-2zm0-8h6v2h-6V6z"/></svg>,
              onClick: onCopyDebugInfo
            }
          ];

          return (
            <ModernToolbar>
              {toolbarConfig.map((item) => {
                if (item.type === 'divider') {
                  return <hr key={item.id} className="toolbar-divider" />;
                }
                const Component = item.component || 'button';
                return (
                  <Component
                    key={item.id}
                    className={`btn-icon ${item.active ? 'active' : ''}`}
                    tooltip={item.tooltip}
                    data-tooltip={item.tooltip}
                    onClick={item.onClick}
                    disabled={item.disabled}
                    style={{ 
                      '--active-bg': item.activeColor || '#3b82f6',
                      ...item.style 
                    }}
                    icon={item.icon}
                  >
                    {item.icon}
                  </Component>
                );
              })}
            </ModernToolbar>
          );
        })()}

        {/* [B-024] 視点同期ツールバー */}
        <ViewSyncToolbar sync={viewSync} />

        {/* [B-025] プレゼンターのマウスポインタ (Remote Cursor) - 独立したフローティングUIとして配置 */}
        {!viewSync.isPresenter && viewSync.isFollowing && viewSync.remoteCursor && (() => {
          const screenPos = flowToScreenPosition({ x: viewSync.remoteCursor.x, y: viewSync.remoteCursor.y });
          if (!screenPos) return null;
          return (
          <div 
            style={{
              position: 'fixed',
              transform: `translate(${screenPos.x}px, ${screenPos.y}px)`,
              left: 0,
              top: 0,
              width: '12px',
              height: '12px',
              backgroundColor: '#22c55e',
              borderRadius: '50%',
              pointerEvents: 'none',
              zIndex: 10000,
              marginTop: '-6px',
              marginLeft: '-6px',
              boxShadow: '0 0 10px rgba(34, 197, 94, 0.8)',
              border: '2px solid white'
            }}
          >
            <div style={{ position: 'absolute', top: '15px', left: '15px', backgroundColor: '#22c55e', color: 'white', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap', fontWeight: 'bold' }}>
              Presenter
            </div>
          </div>
          );
        })()}
      </div>

      {/* ── ノードグラフ右クリックメニュー ── */}
      {ngContextMenu && (
        <NodeGraphContextMenu
          x={ngContextMenu.x}
          y={ngContextMenu.y}
          nodeIds={ngContextMenu.nodeIds}
          ydoc={ydoc}
          onClose={() => setNgContextMenu(null)}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   ノードグラフ右クリックメニュー
══════════════════════════════════════════════ */
function NodeGraphContextMenu({ x, y, nodeIds, ydoc, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [showSub, setShowSub] = useState(false);
  const [diagrams, setDiagrams] = useState([]);

  useEffect(() => {
    const handleDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handleDown);
    return () => document.removeEventListener('mousedown', handleDown);
  }, [onClose]);

  // 画面端で見切れないよう調整
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    let left = x, top = y;
    if (x + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 8;
    if (left < 0) left = 8;
    if (top < 0) top = 8;
    setPos({ left, top });
  }, [x, y]);

  // 既存ブロック図一覧を取得
  useEffect(() => {
    const yBdMeta = ydoc.getMap('bdDiagramsMeta');
    setDiagrams(Array.from(yBdMeta.values()));
  }, [ydoc]);

  const addNodesToLayout = (diagramId) => {
    const mapName = diagramId === 'default' ? 'bdLayout' : `bdLayout_${diagramId}`;
    const yBdLayout = ydoc.getMap(mapName);
    ydoc.transact(() => {
      nodeIds.forEach((nodeId, idx) => {
        if (yBdLayout.has(nodeId)) return;
        const existing = Array.from(yBdLayout.keys()).length;
        const cols = 5;
        const total = existing + idx;
        yBdLayout.set(nodeId, {
          position: { x: (total % cols) * 220 + 40, y: Math.floor(total / cols) * 150 + 40 },
          shape: 'rect', fillColor: '#ffffff',
          borderColor: '#888888', borderWidth: 1.5, textColor: '#111827',
          fontSize: 13, width: 160, height: 60,
        });
      });
    }, 'local');
  };

  const handleNewDiagram = () => {
    const name = `ブロック図 (${nodeIds.length}ノード)`;
    window.dispatchEvent(new CustomEvent('ngCreateDiagramWithNodes', {
      detail: { name, nodeIds }
    }));
    onClose();
  };

  const handleAddToExisting = (diagramId, diagramName) => {
    addNodesToLayout(diagramId);
    // 図のタブを開く
    window.dispatchEvent(new CustomEvent('ngOpenDiagramTab', {
      detail: { diagramId, name: diagramName }
    }));
    onClose();
  };

  const S = {
    menu: {
      position: 'fixed', left: pos.left, top: pos.top, zIndex: 9999,
      background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8,
      boxShadow: '0 8px 24px rgba(0,0,0,0.16)', minWidth: 210,
      fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 13,
      overflow: 'visible', padding: '4px 0',
    },
    item: {
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 14px', cursor: 'pointer', border: 'none',
      background: 'none', width: '100%', textAlign: 'left',
      color: '#374151', fontSize: 13, transition: 'background 0.08s',
    },
    sub: {
      position: 'absolute', left: '100%', top: 0,
      background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8,
      boxShadow: '0 8px 24px rgba(0,0,0,0.16)', minWidth: 180,
      padding: '4px 0', maxHeight: 300, overflowY: 'auto',
    },
  };

  return (
    <div ref={ref} style={S.menu}>
      <div style={{ padding: '4px 14px 6px', fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>
        {nodeIds.length} ノード選択中
      </div>
      <button
        style={S.item}
        onClick={handleNewDiagram}
        onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6'; setShowSub(false); }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
      >
        <span>✚</span> ブロック図を新規作成
      </button>
      {diagrams.length > 0 && (
        <div style={{ position: 'relative' }}>
          <button
            style={{ ...S.item, justifyContent: 'space-between' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6'; setShowSub(true); }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📋</span> 既存ブロック図に追加
            </span>
            <span style={{ opacity: 0.4 }}>▸</span>
          </button>
          {showSub && (
            <div
              style={S.sub}
              onMouseEnter={() => setShowSub(true)}
              onMouseLeave={() => setShowSub(false)}
            >
              {diagrams.map(d => (
                <button
                  key={d.id}
                  style={S.item}
                  onClick={() => handleAddToExisting(d.id, d.name)}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                >
                  {d.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   グローバルコマンドバー (Linear/Figma 風)
══════════════════════════════════════════════ */
function GlobalBar({
  setShowProjectBrowser, setShowDiagramBrowser, onAddTab,
}) {
  const [showViewMenu, setShowViewMenu] = useState(false);
  const viewMenuRef = useRef(null);

  useEffect(() => {
    if (!showViewMenu) return;
    const handler = (e) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target)) setShowViewMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showViewMenu]);

  const S = {
    bar: {
      background: 'linear-gradient(180deg, #1a1a2e 0%, #16162a 100%)',
      display: 'flex', alignItems: 'center',
      padding: '0 12px', height: 32, gap: 2, flexShrink: 0,
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    },
    btn: {
      background: 'transparent', border: 'none', color: '#a0a0b8',
      borderRadius: 6, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer',
      display: 'flex', alignItems: 'center', gap: 5,
      transition: 'background 0.12s, color 0.12s',
      fontWeight: 500, whiteSpace: 'nowrap',
    },
    btnHover: { background: 'rgba(255,255,255,0.07)', color: '#e0e0f0' },
    sep: { width: 1, height: 16, background: 'rgba(255,255,255,0.08)', margin: '0 4px', flexShrink: 0 },
    accent: { color: '#7c8aff' },
    menu: {
      position: 'absolute', top: 'calc(100% + 4px)', left: 0,
      background: '#252533', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 8, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
      zIndex: 9999, minWidth: 220, padding: '4px 0',
      animation: 'tabMenuFadeIn 0.12s ease-out',
    },
    menuItem: {
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 14px', cursor: 'pointer', color: '#c8c8d8',
      fontSize: 12, transition: 'background 0.08s, color 0.08s',
    },
    menuIcon: { width: 16, height: 16, opacity: 0.7, flexShrink: 0 },
  };

  return (
    <div style={S.bar}>
      {/* プロジェクトブラウザボタン */}
      <button
        style={{ ...S.btn, fontWeight: 600, color: '#e0e0f0' }}
        onClick={setShowProjectBrowser}
        onMouseEnter={e => Object.assign(e.currentTarget.style, S.btnHover)}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#e0e0f0'; }}
        title="プロジェクト切替"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.7 }}>
          <path d="M1.5 1A1.5 1.5 0 000 2.5v11A1.5 1.5 0 001.5 15h13a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0014.5 3H7.71l-1.6-1.6A1.5 1.5 0 005.05 1H1.5z"/>
        </svg>
        プロジェクト
      </button>

      <div style={S.sep} />

      {/* 図を開く */}
      <button
        style={S.btn}
        onClick={setShowDiagramBrowser}
        onMouseEnter={e => Object.assign(e.currentTarget.style, S.btnHover)}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#a0a0b8'; }}
        title="ブロック図を開く"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.6 }}>
          <path d="M2 2h5v5H2V2zm7 0h5v5H9V2zM2 9h5v5H2V9zm7 0h5v5H9V9z"/>
        </svg>
        図を開く
      </button>

      {/* 図を追加 */}
      <button
        style={{ ...S.btn, ...S.accent }}
        onClick={() => onAddTab('block-diagram')}
        onMouseEnter={e => Object.assign(e.currentTarget.style, { background: 'rgba(124,138,255,0.12)', color: '#a0b4ff' })}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#7c8aff'; }}
        title="新しいブロック図を作成"
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a1 1 0 011 1v5h5a1 1 0 110 2H9v5a1 1 0 11-2 0V9H2a1 1 0 110-2h5V2a1 1 0 011-1z"/>
        </svg>
        図を追加
      </button>

      <div style={S.sep} />

      {/* ビュー追加 */}
      <div style={{ position: 'relative' }} ref={viewMenuRef}>
        <button
          style={S.btn}
          onClick={() => setShowViewMenu(v => !v)}
          onMouseEnter={e => Object.assign(e.currentTarget.style, S.btnHover)}
          onMouseLeave={e => { if (!showViewMenu) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#a0a0b8'; } }}
          title="ビューを追加"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.6 }}>
            <path d="M14 1H2a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V2a1 1 0 00-1-1zM2 0a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V2a2 2 0 00-2-2H2z"/>
            <path d="M8 4a.5.5 0 01.5.5v3h3a.5.5 0 010 1h-3v3a.5.5 0 01-1 0v-3h-3a.5.5 0 010-1h3v-3A.5.5 0 018 4z"/>
          </svg>
          ビュー追加
          <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.5 }}>
            <path d="M4 6l4 4 4-4H4z"/>
          </svg>
        </button>

        {showViewMenu && (
          <div style={S.menu}>
            {VIEW_TYPES.map(vt => (
              <div
                key={vt.type}
                style={S.menuItem}
                onClick={() => { onAddTab(vt.type); setShowViewMenu(false); }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#c8c8d8'; }}
              >
                <span style={S.menuIcon}>{vt.icon}</span>
                <span>{vt.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// タブID生成カウンター
let _tabIdCounter = 2;

export default function App() {
  // ── プロジェクト状態 ──
  const [activeProjectId, setActiveProjectId] = useState(null); // Start with null, wait for registry
  const [projectKey, setProjectKey] = useState(0);
  const [appProjectName, setAppProjectName] = useState(() => {
    const p = projectStore.getProjects().find(pr => pr.id === projectStore.getActiveProjectId());
    return p?.name || 'プロジェクト';
  });

  // ── タブ状態（localStorage から復元） ──
  const [tabs, setTabs] = useState(() => {
    const saved = projectStore.getTabState(projectStore.getActiveProjectId());
    return saved?.tabs || [{ id: 'tab-1', type: 'node-graph', title: 'ノードグラフ' }];
  });
  const [activeTabId, setActiveTabId] = useState(() => {
    const saved = projectStore.getTabState(projectStore.getActiveProjectId());
    return saved?.activeTabId || 'tab-1';
  });

  // ── ダイアログ表示状態 ──
  const [showProjectBrowser, setShowProjectBrowser] = useState(false);
  const [showDiagramBrowser, setShowDiagramBrowser] = useState(false);

  // [修正] アプリケーション起動時にサーバーからプロジェクトリストを取得し、Yjsを初期化
  useEffect(() => {
    // projectRegistryが初期化されるのを待つ
    const unobserve = projectStore.observeProjects((projects) => {
      if (projects.length > 0) {
        const initialProjectId = projectStore.getActiveProjectId(); // これで有効なIDが取れる
        setActiveProjectId(initialProjectId);
        ydoc = initYjsForProject(initialProjectId);
        setProjectKey(k => k + 1); // Force re-render of children with new ydoc
        unobserve(); // 一度だけ実行
      }
    });
  }, []);

  // ── Yjs projectMeta の名前変更を監視 ──
  useEffect(() => {
    const ypm = ydoc.getMap('projectMeta');
    const handler = () => {
      const n = ypm.get('name');
      if (n) setAppProjectName(n);
    };
    ypm.observe(handler);
    return () => ypm.unobserve(handler);
  }, [projectKey]);

  // ── タブを localStorage に自動保存 ──
  useEffect(() => {
    projectStore.saveTabs(activeProjectId, tabs, activeTabId);
  }, [tabs, activeTabId, activeProjectId]);

  // ── ブロック図を新規作成してタブを開く ──
  const createAndOpenDiagram = useCallback((name = '新しいブロック図') => {
    const diagramId = 'bd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 4);
    const yBdMeta = ydoc.getMap('bdDiagramsMeta');
    ydoc.transact(() => {
      yBdMeta.set(diagramId, { id: diagramId, name, createdAt: new Date().toISOString() });
    }, 'local');
    const id = `tab-${_tabIdCounter++}`;
    setTabs(prev => [...prev, { id, type: 'block-diagram', title: name, diagramId }]);
    setActiveTabId(id);
    setShowDiagramBrowser(false);
    return diagramId;
  }, []);

  // ── 既存ブロック図を開く（タブが既にあればフォーカス） ──
  const openDiagram = useCallback((diagramId, name) => {
    const existing = tabs.find(t => t.type === 'block-diagram' && t.diagramId === diagramId);
    if (existing) { setActiveTabId(existing.id); setShowDiagramBrowser(false); return; }
    const id = `tab-${_tabIdCounter++}`;
    setTabs(prev => [...prev, { id, type: 'block-diagram', title: name, diagramId }]);
    setActiveTabId(id);
    setShowDiagramBrowser(false);
  }, [tabs]);

  // ── ノードグラフ右クリックからのカスタムイベントをハンドリング ──
  useEffect(() => {
    const handleCreate = (e) => {
      const { name, nodeIds } = e.detail;
      const diagramId = createAndOpenDiagram(name);
      // 作成した図にノードを追加
      const mapName = `bdLayout_${diagramId}`;
      const yBdLayout = ydoc.getMap(mapName);
      ydoc.transact(() => {
        nodeIds.forEach((nodeId, idx) => {
          const cols = 5;
          yBdLayout.set(nodeId, {
            position: { x: (idx % cols) * 220 + 40, y: Math.floor(idx / cols) * 150 + 40 },
            shape: 'rect', fillColor: '#ffffff',
            borderColor: '#888888', borderWidth: 1.5, textColor: '#111827',
            fontSize: 13, width: 160, height: 60,
          });
        });
      }, 'local');
    };
    const handleOpen = (e) => {
      const { diagramId, name } = e.detail;
      openDiagram(diagramId, name);
    };
    window.addEventListener('ngCreateDiagramWithNodes', handleCreate);
    window.addEventListener('ngOpenDiagramTab', handleOpen);
    return () => {
      window.removeEventListener('ngCreateDiagramWithNodes', handleCreate);
      window.removeEventListener('ngOpenDiagramTab', handleOpen);
    };
  }, [createAndOpenDiagram, openDiagram]);

  // ── プロジェクト切り替え ──
  const switchProject = useCallback((projectId) => {
    projectStore.saveTabs(activeProjectId, tabs, activeTabId);
    ydoc = initYjsForProject(projectId);
    projectStore.setActiveProjectId(projectId);
    const saved = projectStore.getTabState(projectId);
    const newTabs = saved?.tabs || [{ id: 'tab-1', type: 'node-graph', title: 'ノードグラフ' }];
    const newActiveTabId = saved?.activeTabId || 'tab-1';
    setActiveProjectId(projectId);
    setTabs(newTabs);
    setActiveTabId(newActiveTabId);
    setShowProjectBrowser(false);
    // 切り替え先のプロジェクト名を反映
    const proj = projectStore.getProjects().find(p => p.id === projectId);
    setAppProjectName(proj?.name || 'プロジェクト');
    setProjectKey(k => k + 1);
  }, [activeProjectId, tabs, activeTabId]);

  
  // ── プロジェクト削除 ──
  const deleteProject = useCallback(async (projectIdToDelete) => {
    const projectToDelete = projectStore.findProject(projectIdToDelete);
    if (!window.confirm(`プロジェクト「${projectToDelete?.name || projectIdToDelete}」を削除しますか？\nこの操作は取り消せません。`)) {
      return;
    }

    // サーバーへの削除リクエストが完了するのを待つ
    await projectStore.deleteProject(projectIdToDelete);

    // WebSocket経由で更新された最新のプロジェクトリストを取得
    const remainingProjects = projectStore.getProjects();

    if (remainingProjects.length > 0) {
      // 削除したプロジェクトが現在開いているものだった場合、先頭のプロジェクトに切り替える
      if (activeProjectId === projectIdToDelete) {
        switchProject(remainingProjects[0].id);
      }
    } else {
      setActiveProjectId(null);
      setShowProjectBrowser(false);
    }
  }, [switchProject]);
  
  // ── ビュー追加（ブロック図は createAndOpenDiagram で処理） ──
  const addTab = useCallback((type) => {
    if (type === 'block-diagram') { createAndOpenDiagram(); return; }
    const viewDef = VIEW_TYPES.find((vt) => vt.type === type);
    if (viewDef?.singleton) {
      const existing = tabs.find((t) => t.type === type);
      if (existing) { setActiveTabId(existing.id); return; }
    }
    const id = `tab-${_tabIdCounter++}`;
    const newTab = { id, type, title: viewDef?.title || type };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
  }, [tabs, createAndOpenDiagram]);

  // ── タブを閉じる ──
  const closeTab = useCallback((tabId) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((t) => t.id === tabId);
      const next = prev.filter((t) => t.id !== tabId);
      setActiveTabId((cur) => {
        if (cur !== tabId) return cur;
        return (next[idx] ?? next[idx - 1])?.id ?? next[0]?.id;
      });
      return next;
    });
  }, []);

  // ── タブ並び替え ──
  const reorderTab = useCallback((dragId, dropId, side) => {
    setTabs(prev => {
      const dragged = prev.find(t => t.id === dragId);
      if (!dragged) return prev;
      const without = prev.filter(t => t.id !== dragId);
      const dropIdx = without.findIndex(t => t.id === dropId);
      if (dropIdx < 0) return prev;
      const insertIdx = side === 'right' ? dropIdx + 1 : dropIdx;
      without.splice(insertIdx, 0, dragged);
      return without;
    });
  }, []);

  // ── これ以外を閉じる ──
  const closeOtherTabs = useCallback((keepTabId) => {
    setTabs(prev => prev.filter(t => t.id === keepTabId));
    setActiveTabId(keepTabId);
  }, []);

  // ── すべて閉じる（ノードグラフを残す） ──
  const closeAllTabs = useCallback(() => {
    const ngTab = tabs.find(t => t.type === 'node-graph');
    if (ngTab) {
      setTabs([ngTab]);
      setActiveTabId(ngTab.id);
    } else {
      const fallback = { id: 'tab-1', type: 'node-graph', title: 'ノードグラフ' };
      setTabs([fallback]);
      setActiveTabId(fallback.id);
    }
  }, [tabs]);

  // ── タブのタイトル変更 ──
  const renameTab = useCallback((tabId, newName) => {
    setTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      // ブロック図タブ → bdDiagramsMeta も更新
      if (t.type === 'block-diagram' && t.diagramId) {
        const yBdMeta = ydoc.getMap('bdDiagramsMeta');
        const meta = yBdMeta.get(t.diagramId);
        if (meta) ydoc.transact(() => yBdMeta.set(t.diagramId, { ...meta, name: newName }), 'local');
      }
      // ノードグラフ → Yjs projectMeta も更新
      if (t.type === 'node-graph') {
        const yProjectMeta = ydoc.getMap('projectMeta');
        yProjectMeta.set('name', newName);
      }
      return { ...t, title: newName };
    }));
  }, []);

  // ── プロジェクト名変更 ──
  const commitProjectName = useCallback((newName) => {
    const name = (typeof newName === 'string' ? newName : '').trim();
    if (name) {
      projectStore.renameProject(activeProjectId, name);
      const ypm = ydoc.getMap('projectMeta');
      ypm.set('name', name);
      setAppProjectName(name);
    }
  }, [activeProjectId]);

  const currentProjectName = appProjectName;
  const openBdIds = tabs.filter(t => t.type === 'block-diagram').map(t => t.diagramId).filter(Boolean);

  // ── 一覧表から図を開いてノードにフォーカス ──
  const [focusNodeId, setFocusNodeId] = useState(null);
  const handleOpenDiagramFromTable = useCallback((bdTabId, nodeId) => {
    const tab = tabs.find(t => t.id === bdTabId);
    if (tab) {
      setActiveTabId(bdTabId);
      setFocusNodeId(nodeId);
    }
  }, [tabs]);

  // ── プロジェクトが存在しない場合のUI ──
  if (!activeProjectId) {
    return (
      <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#1e1e1e' }}>
        {/* グローバルコマンドバーのみ表示 */}
        <GlobalBar
          setShowProjectBrowser={() => setShowProjectBrowser(true)}
          setShowDiagramBrowser={() => { /* プロジェクトがないので何もしない */ }}
          onAddTab={() => { /* プロジェクトがないので何もしない */ }}
        />
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#a0a0b8', fontFamily: 'system-ui' }}>
          <div>
            <p>プロジェクトが選択されていません。</p>
            <p>「プロジェクト」メニューから既存のプロジェクトを開くか、新規作成してください。</p>
          </div>
        </div>

        {/* ── プロジェクトブラウザ（プロジェクトがない場合もここから作成するため必要） ── */}
        {showProjectBrowser && (
          <ProjectBrowserDialog
            activeProjectId={activeProjectId}
            onSwitch={switchProject}
            onDelete={deleteProject}
            onClose={() => setShowProjectBrowser(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div key={projectKey} style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── グローバルコマンドバー ── */}
      <GlobalBar
        setShowProjectBrowser={() => setShowProjectBrowser(true)}
        setShowDiagramBrowser={() => setShowDiagramBrowser(true)}
        onAddTab={addTab}
      />

      {/* VS Code 風タブバー */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onTabChange={setActiveTabId}
        onTabClose={closeTab}
        onTabRename={renameTab}
        onReorder={reorderTab}
        onCloseOthers={closeOtherTabs}
        onCloseAll={closeAllTabs}
        projectName={currentProjectName}
        onProjectNameChange={commitProjectName}
      />

      {/* ビューコンテナ */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {(() => {
          const tab = tabs.find(t => t.id === activeTabId);
          if (!tab) return null;
          return (
            <div key={tab.id} style={{ position: 'absolute', inset: 0 }}>
              {tab.type === 'node-graph' && (
                <ReactFlowProvider>
                  <Flow />
                </ReactFlowProvider>
              )}
              {tab.type === 'table' && <TableView ydoc={ydoc} tabs={tabs} onOpenDiagram={handleOpenDiagramFromTable} />}
              {tab.type === 'block-diagram' && (
                <BlockDiagramView ydoc={ydoc} diagramId={tab.diagramId || 'default'} focusNodeId={tab.id === activeTabId ? focusNodeId : null} onFocusDone={() => setFocusNodeId(null)} />
              )}
              {tab.type === 'function-flow' && (
                <PlaceholderView type="function-flow" title="Function Flow Diagram" />
              )}
            </div>
          );
        })()}
      </div>

      {/* ── プロジェクトブラウザ ── */}
      {showProjectBrowser && (
        <ProjectBrowserDialog
          activeProjectId={activeProjectId}
          onSwitch={switchProject}
          onDelete={deleteProject}
          onClose={() => setShowProjectBrowser(false)}
        />
      )}

      {/* ── ブロック図ブラウザ ── */}
      {showDiagramBrowser && (
        <DiagramBrowserDialog
          ydoc={ydoc}
          openTabDiagramIds={openBdIds}
          onOpen={openDiagram}
          onNew={createAndOpenDiagram}
          onClose={() => setShowDiagramBrowser(false)}
        />
      )}
    </div>
  );
}