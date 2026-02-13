import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: 'running' | 'paused' | 'open' | 'closed' | string;
  size?: 'sm' | 'md';
}

const statusStyles: Record<string, string> = {
  running: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  paused: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  open: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  closed: 'bg-red-500/10 text-red-500 border-red-500/20',
};

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium capitalize',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
        statusStyles[status] || 'bg-muted text-muted-foreground border-border',
      )}
    >
      <span
        className={cn(
          'inline-block rounded-full',
          size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2',
          status === 'running' || status === 'open'
            ? 'bg-emerald-500 animate-pulse'
            : status === 'paused'
              ? 'bg-amber-500'
              : 'bg-red-500',
        )}
      />
      {status}
    </span>
  );
}
