import React from 'react';
import type { Toast } from '../hooks/useToasts';

export type ToastStackProps = {
  toasts: Toast[];
  onDismiss: (id: number) => void;
};

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (!toasts.length) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 1000,
      }}
    >
      {toasts.map((toast) => {
        const bg =
          toast.variant === 'error'
            ? '#7f1d1d'
            : toast.variant === 'warning'
            ? '#78350f'
            : toast.variant === 'success'
            ? '#0f5132'
            : '#1f2937';
        const border =
          toast.variant === 'error'
            ? '#f87171'
            : toast.variant === 'warning'
            ? '#facc15'
            : toast.variant === 'success'
            ? '#34d399'
            : '#93c5fd';
        return (
          <div
            key={toast.id}
            style={{
              minWidth: 260,
              maxWidth: 340,
              padding: '10px 14px',
              borderRadius: 10,
              border: `1px solid ${border}`,
              background: bg,
              color: '#f9fafb',
              boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div style={{ flex: 1, fontSize: 14 }}>{toast.message}</div>
            <button
              onClick={() => onDismiss(toast.id)}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#f9fafb',
                fontSize: 14,
                cursor: 'pointer',
              }}
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
