import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils';

interface PnlDisplayProps {
  value: number;
  percentage?: number;
  size?: 'sm' | 'md' | 'lg';
}

export function PnlDisplay({ value, percentage, size = 'md' }: PnlDisplayProps) {
  const isPositive = value >= 0;

  return (
    <span
      className={cn(
        'font-semibold tabular-nums',
        isPositive ? 'text-emerald-500' : 'text-red-500',
        size === 'sm' && 'text-sm',
        size === 'md' && 'text-base',
        size === 'lg' && 'text-2xl',
      )}
    >
      {isPositive ? '+' : ''}
      {formatCurrency(value)}
      {percentage !== undefined && (
        <span className="ml-1 text-[0.85em] opacity-80">
          ({isPositive ? '+' : ''}
          {(percentage * 100).toFixed(2)}%)
        </span>
      )}
    </span>
  );
}
