import type { Toast } from '../hooks/useToasts';

type ToastStackProps = {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  maxVisible?: number;
};

const VARIANT_COLORS: Record<Toast['variant'], { bg: string; border: string }> = {
  info: { bg: 'rgba(32, 52, 71, 0.95)', border: '#5eb4ff' },
  success: { bg: 'rgba(24, 54, 38, 0.95)', border: '#3fc37c' },
  warning: { bg: 'rgba(67, 51, 19, 0.95)', border: '#ffbb4d' },
  error: { bg: 'rgba(67, 24, 24, 0.95)', border: '#ff6b6b' },
};

export function ToastStack({ toasts, onDismiss, maxVisible = 4 }: ToastStackProps) {
  if (!toasts.length) return null;
  const visible = toasts.slice(-maxVisible);
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      {visible.map((toast) => {
        const palette = VARIANT_COLORS[toast.variant] ?? VARIANT_COLORS.info;
        return (
          <div
            key={toast.id}
            role="status"
            aria-live="polite"
            style={{
              minWidth: 220,
              maxWidth: 360,
              background: palette.bg,
              border: `1px solid ${palette.border}`,
              color: '#f2f4f8',
              borderRadius: 6,
              padding: '10px 12px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
              fontSize: 13,
              lineHeight: 1.35,
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span style={{ flex: 1 }}>{toast.message}</span>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#f2f4f8',
                fontSize: 16,
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
              }}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
