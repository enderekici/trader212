'use client';

import { useState } from 'react';
import { Save } from 'lucide-react';
import type { ConfigItem } from '@/lib/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface ConfigEditorProps {
  category: string;
  items: ConfigItem[];
  onUpdate?: () => void;
}

export function ConfigEditor({ category, items, onUpdate }: ConfigEditorProps) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(items.map((item) => [item.key, JSON.stringify(item.value)])),
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function handleSave(key: string) {
    setSaving(key);
    try {
      const parsed = JSON.parse(values[key]);
      await api.updateConfig(key, parsed);
      setSaved(key);
      setTimeout(() => setSaved(null), 2000);
      onUpdate?.();
    } catch {
      // reset to original
      const original = items.find((i) => i.key === key);
      if (original) {
        setValues((v) => ({ ...v, [key]: JSON.stringify(original.value) }));
      }
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold capitalize">{category}</h3>
      </div>
      <div className="divide-y divide-border">
        {items.map((item) => {
          const shortKey = item.key.split('.').slice(1).join('.');
          const isModified = values[item.key] !== JSON.stringify(item.value);
          return (
            <div key={item.key} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{shortKey}</div>
                {item.description && (
                  <div className="text-xs text-muted-foreground">{item.description}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={values[item.key]}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [item.key]: e.target.value }))
                  }
                  className="w-48 rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground outline-none focus:border-ring"
                />
                <button
                  type="button"
                  onClick={() => handleSave(item.key)}
                  disabled={!isModified || saving === item.key}
                  className={cn(
                    'rounded-md p-1.5 transition-colors',
                    isModified
                      ? 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'
                      : 'text-muted-foreground opacity-30',
                    saved === item.key && 'bg-emerald-500/20 text-emerald-400',
                  )}
                >
                  <Save className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
