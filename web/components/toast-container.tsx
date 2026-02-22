'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';
import { useToast, type Toast } from '@/lib/toast-context';
import { cn } from '@/lib/utils';

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
} as const;

const styleMap = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  error: 'border-red-500/30 bg-red-500/10 text-red-400',
  info: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
} as const;

function ToastItem({ toast }: { toast: Toast }) {
  const { removeToast } = useToast();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation on next frame
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const Icon = iconMap[toast.type];

  const handleDismiss = () => {
    setVisible(false);
    // Wait for the exit animation before removing
    setTimeout(() => removeToast(toast.id), 200);
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm transition-all duration-200',
        styleMap[toast.type],
        visible
          ? 'translate-x-0 opacity-100'
          : 'translate-x-4 opacity-0',
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 rounded p-0.5 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
