import React from 'react';

/**
 * 未実装ビューのプレースホルダー
 *
 * Props:
 *   type  - ビュータイプ ('block-diagram' | 'function-flow' など)
 *   title - ビュータイトル
 */

const ICONS = {
  'block-diagram': (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4"  y="4"  width="20" height="14" rx="3" />
      <rect x="40" y="4"  width="20" height="14" rx="3" />
      <rect x="22" y="46" width="20" height="14" rx="3" />
      <line x1="24" y1="11" x2="40" y2="11" />
      <line x1="14" y1="18" x2="14" y2="32" />
      <line x1="50" y1="18" x2="50" y2="32" />
      <line x1="14" y1="32" x2="50" y2="32" />
      <line x1="32" y1="32" x2="32" y2="46" />
    </svg>
  ),
  'function-flow': (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2"  y="24" width="16" height="16" rx="3" />
      <rect x="24" y="24" width="16" height="16" rx="3" />
      <rect x="46" y="24" width="16" height="16" rx="3" />
      <line x1="18" y1="32" x2="24" y2="32" />
      <polyline points="21,29 24,32 21,35" />
      <line x1="40" y1="32" x2="46" y2="32" />
      <polyline points="43,29 46,32 43,35" />
    </svg>
  ),
};

export default function PlaceholderView({ type, title }) {
  const icon = ICONS[type];

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f9fafb',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
        userSelect: 'none',
        gap: 16,
      }}
    >
      {icon && (
        <div
          style={{
            width: 72,
            height: 72,
            color: '#d1d5db',
          }}
        >
          {icon}
        </div>
      )}
      <div style={{ fontSize: 22, fontWeight: 600, color: '#6b7280' }}>{title}</div>
      <div
        style={{
          fontSize: 13,
          color: '#9ca3af',
          border: '1px dashed #d1d5db',
          borderRadius: 8,
          padding: '8px 20px',
          background: '#fff',
        }}
      >
        このビューは現在開発中です
      </div>
    </div>
  );
}
