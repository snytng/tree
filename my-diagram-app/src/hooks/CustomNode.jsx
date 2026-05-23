import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Handle, Position } from 'reactflow';

const CustomNode = ({ id, data, selected }) => {
  const { isEdgeSourceCandidate, isPresenterSelected } = data;
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(data.label);
  const inputRef = useRef(null);

  // data.label が外部（同期など）から変更されたら反映
  useEffect(() => {
    setEditValue(data.label);
  }, [data.label]);

  // 編集モード時にフォーカスを当てる
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsEditing(true);
  }, []);

  // F2キーでの編集開始
  useEffect(() => {
    const handleKeyDownGlobal = (e) => {
      if (e.key === 'F2' && selected && !isEditing) {
        setIsEditing(true);
      }
    };
    window.addEventListener('keydown', handleKeyDownGlobal);
    return () => window.removeEventListener('keydown', handleKeyDownGlobal);
  }, [selected, isEditing]);

  const commit = useCallback(() => {
    setIsEditing(false);
    if (editValue !== data.label) {
      // カスタムイベントを介して yDoc 管理側へ通知
      window.dispatchEvent(new CustomEvent('nodeLabelUpdate', { 
        detail: { id, label: editValue } 
      }));
    }
  }, [id, editValue, data.label]);

  const handleKeyDown = (e) => {
    // 編集中のキー入力が React Flow やグローバルなナビゲーションに伝わらないようにする
    e.stopPropagation();
    if (e.key === 'Enter') {
      commit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditValue(data.label); // キャンセル
    }
  };

  return (
    <div 
      className={`custom-node ${selected ? 'selected' : ''} ${isEdgeSourceCandidate ? 'edge-source-candidate' : ''} ${isPresenterSelected ? 'presenter-selected' : ''} ${data.nodeClass || ''}`} // クラスを追加
      tabIndex={0}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'relative',
        overflow: 'visible', // バッジのはみ出しを許可
        boxSizing: 'border-box',
        width: '180px',
        height: '60px',
        padding: '10px',
        borderRadius: '5px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Handle type="target" position={Position.Left} />
      {data.nodeClass && data.nodeClass !== '' && (
        <div className="node-class-badge">
          {data.nodeClass.replace('node-class-', '').toUpperCase()}
        </div>
      )}
      <div className="node-label-container" style={{ width: '100%', textAlign: 'center', pointerEvents: 'none', position: 'relative' }}>
        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            className="nodrag"
            style={{ width: '90%', textAlign: 'center', border: '1px solid #ccc' }}
          />
        ) : (
          <div style={{ fontSize: '12px', wordBreak: 'break-all' }}>{data.label}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
};

export default CustomNode;