import React, { useState, useEffect, useRef } from 'react';
import './ModernToolbar.css';

const ModernToolbar = ({ children }) => {
  // 折りたたみ状態を LocalStorage から復元
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('toolbar-collapsed');
    return saved === 'true';
  });

  const [position, setPosition] = useState(() => {
    const saved = localStorage.getItem('toolbar-pos');
    return saved ? JSON.parse(saved) : { x: window.innerWidth - 60, y: 50 };
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });

  // 折りたたみ状態が変わるたびに保存
  useEffect(() => {
    localStorage.setItem('toolbar-collapsed', isCollapsed);
  }, [isCollapsed]);

  const handlePointerDown = (e) => {
    // キャンバスへのイベント伝播を防止
    e.stopPropagation();
    setIsDragging(true);
    dragStartPos.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
    e.target.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    e.stopPropagation();
    
    const newX = e.clientX - dragStartPos.current.x;
    const newY = e.clientY - dragStartPos.current.y;
    
    // 画面外への逸脱防止（簡易）
    const boundedX = Math.max(0, Math.min(newX, window.innerWidth - 50));
    const boundedY = Math.max(0, Math.min(newY, window.innerHeight - 50));
    
    setPosition({ x: boundedX, y: boundedY });
  };

  const handlePointerUp = (e) => {
    if (!isDragging) return;
    setIsDragging(false);
    localStorage.setItem('toolbar-pos', JSON.stringify(position));
  };

  return (
    <div 
      className={`modern-toolbar ${isCollapsed ? 'collapsed' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{ 
        transform: `translate(${position.x}px, ${position.y}px)`
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      // ツールバー全体でクリックがキャンバスに抜けないようにする
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div 
        className="toolbar-handle" 
        onPointerDown={handlePointerDown}
        title="ドラッグして移動"
      >
        <div className="handle-dots">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
      
      <div className="toolbar-content">
        {children}
      </div>

      <button 
        className="toolbar-collapse-btn" 
        onClick={() => setIsCollapsed(!isCollapsed)}
        title={isCollapsed ? "ツールバーを展開" : "ツールバーを折りたたむ"}
      >
        {isCollapsed ? '▼' : '▲'}
      </button>
    </div>
  );
};

export default ModernToolbar;