'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { StatusResponse } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AlertTriangle, Shield, Clock, Power } from 'lucide-react';

export function HeaderBar() {
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    const load = () => {
      api.getStatus().then(setStatus).catch(() => {});
    };
    load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, []);

  if (!status) return null;

  const isLive = status.environment === 'live';
  const isDryRun = status.dryRun;
  const mt = status.marketTimes;

  const formatCountdown = (mins: number) => {
    if (mins <= 0) return '';
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const marketStatusColor = {
    open: 'text-emerald-400',
    pre: 'text-yellow-400',
    after: 'text-orange-400',
    closed: 'text-zinc-500',
  }[mt?.marketStatus ?? 'closed'];

  const marketStatusLabel = {
    open: 'Market Open',
    pre: 'Pre-Market',
    after: 'After Hours',
    closed: 'Market Closed',
  }[mt?.marketStatus ?? 'closed'];

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2 text-xs mb-4">
      {/* Environment badge */}
      <span className={cn(
        'rounded px-2 py-0.5 font-bold uppercase',
        isLive ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
      )}>
        {status.environment}
      </span>

      {/* Account type */}
      <span className="rounded bg-blue-500/20 px-2 py-0.5 font-medium text-blue-400 border border-blue-500/30">
        {status.accountType}
      </span>

      {/* Dry run badge */}
      {isDryRun && (
        <span className="rounded bg-yellow-500/20 px-2 py-0.5 font-medium text-yellow-400 border border-yellow-500/30 flex items-center gap-1">
          <Shield className="h-3 w-3" />
          DRY RUN
        </span>
      )}

      {/* Bot status */}
      <span className={cn(
        'flex items-center gap-1',
        status.status === 'paused' ? 'text-yellow-400' : 'text-emerald-400'
      )}>
        <Power className="h-3 w-3" />
        {status.status === 'paused' ? 'PAUSED' : 'RUNNING'}
      </span>

      <span className="text-border">|</span>

      {/* Market status */}
      <span className={cn('flex items-center gap-1', marketStatusColor)}>
        <Clock className="h-3 w-3" />
        {marketStatusLabel}
        {mt && mt.countdownMinutes > 0 && (
          <span className="text-muted-foreground">
            ({mt.marketStatus === 'open' ? 'closes' : 'opens'} in {formatCountdown(mt.countdownMinutes)})
          </span>
        )}
      </span>

      {mt?.isHoliday && (
        <span className="text-orange-400 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Holiday
        </span>
      )}

      {mt?.isEarlyClose && (
        <span className="text-yellow-400">Early Close</span>
      )}

      {/* Current time ET */}
      {mt && (
        <span className="ml-auto text-muted-foreground">
          ET: {mt.currentTimeET?.split('T')[1]?.split('.')[0] ?? ''}
        </span>
      )}

      {/* Emergency stop */}
      <button
        onClick={() => {
          if (confirm('EMERGENCY STOP: This will close ALL positions and pause the bot. Continue?')) {
            api.emergencyStop().catch(console.error);
          }
        }}
        className="ml-2 rounded bg-red-600 px-2 py-0.5 font-bold text-white hover:bg-red-700 transition-colors"
      >
        STOP
      </button>
    </div>
  );
}
