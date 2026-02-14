'use client';

import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import type { ConfigItem } from '@/lib/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// Known enum options for select dropdowns
const ENUM_OPTIONS: Record<string, string[]> = {
  't212.environment': ['demo', 'live'],
  't212.accountType': ['INVEST', 'ISA'],
  'ai.provider': ['anthropic', 'ollama', 'openai-compatible'],
  'pairlist.mode': ['dynamic', 'static', 'hybrid'],
  'reports.schedule': ['daily', 'weekly', 'both'],
  'monitoring.weeklyReportDay': [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ],
};

// Predefined options for array configs
const TAG_PRESETS: Record<string, string[]> = {
  'pairlist.filters': ['volume', 'price', 'marketCap', 'volatility', 'blacklist', 'maxPairs'],
  'multiTimeframe.timeframes': ['1d', '4h', '1h', '30m', '15m'],
};

type ValueType = 'boolean' | 'number' | 'select' | 'string' | 'tags' | 'json';

function detectType(key: string, value: unknown): ValueType {
  if (ENUM_OPTIONS[key]) return 'select';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (Array.isArray(value)) {
    // Arrays of objects → JSON editor; arrays of primitives → tag chips
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) return 'json';
    return 'tags';
  }
  if (typeof value === 'object' && value !== null) return 'json';
  if (typeof value === 'string') return 'string';
  return 'json';
}

function isNumberArray(arr: unknown[]): boolean {
  return arr.length > 0 && arr.every((v) => typeof v === 'number');
}

// ── Main export ──────────────────────────────────────────────────────────────

interface ConfigEditorProps {
  category: string;
  items: ConfigItem[];
  onUpdate?: () => void;
}

export function ConfigEditor({ category, items, onUpdate }: ConfigEditorProps) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{category}</h3>
      </div>
      <div className="divide-y divide-border">
        {items.map((item) => (
          <ConfigRow key={item.key} item={item} onUpdate={onUpdate} />
        ))}
      </div>
    </div>
  );
}

// ── Row per config item ──────────────────────────────────────────────────────

function ConfigRow({ item, onUpdate }: { item: ConfigItem; onUpdate?: () => void }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shortKey = item.key.split('.').slice(1).join('.');
  const type = detectType(item.key, item.value);

  async function handleSave(value: unknown) {
    setSaving(true);
    setError(null);
    try {
      await api.updateConfig(item.key, value);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onUpdate?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const inlineTypes: ValueType[] = ['boolean', 'number', 'select', 'string'];
  const isInline = inlineTypes.includes(type);

  return (
    <div className="px-4 py-3">
      <div className={cn('flex gap-3', isInline ? 'items-center' : 'flex-col')}>
        {/* Label */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{shortKey}</span>
            {saved && (
              <span className="flex items-center gap-0.5 text-xs text-emerald-500">
                <Check className="h-3 w-3" /> Saved
              </span>
            )}
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
          {item.description && (
            <div className="text-xs text-muted-foreground">{item.description}</div>
          )}
        </div>

        {/* Input */}
        {type === 'boolean' && (
          <ToggleInput value={item.value as boolean} onSave={handleSave} disabled={saving} />
        )}
        {type === 'number' && (
          <NumberInput value={item.value as number} onSave={handleSave} disabled={saving} />
        )}
        {type === 'select' && (
          <SelectInput
            value={item.value as string}
            options={ENUM_OPTIONS[item.key]}
            onSave={handleSave}
            disabled={saving}
          />
        )}
        {type === 'string' && (
          <StringInput value={item.value as string} onSave={handleSave} disabled={saving} />
        )}
        {type === 'tags' && (
          <TagsInput
            value={item.value as unknown[]}
            onSave={handleSave}
            disabled={saving}
            presets={TAG_PRESETS[item.key]}
          />
        )}
        {type === 'json' && (
          <JsonInput value={item.value} onSave={handleSave} disabled={saving} />
        )}
      </div>
    </div>
  );
}

// ── Toggle switch for booleans ───────────────────────────────────────────────

function ToggleInput({
  value,
  onSave,
  disabled,
}: { value: boolean; onSave: (v: boolean) => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onSave(!value)}
      className={cn(
        'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full transition-colors',
        value ? 'bg-emerald-500' : 'bg-muted-foreground/30',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
          value ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}

// ── Number input ─────────────────────────────────────────────────────────────

function NumberInput({
  value,
  onSave,
  disabled,
}: { value: number; onSave: (v: number) => void; disabled: boolean }) {
  const [local, setLocal] = useState(String(value));
  const isModified = local !== '' && Number(local) !== value && !Number.isNaN(Number(local));

  // Infer step from current value
  const abs = Math.abs(value);
  const step = abs === 0 ? 1 : abs < 0.01 ? 0.001 : abs < 1 ? 0.01 : abs < 10 ? 0.1 : 1;

  function save() {
    const num = Number(local);
    if (!Number.isNaN(num)) onSave(num);
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        value={local}
        step={step}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && isModified && save()}
        disabled={disabled}
        className="w-36 rounded-md border border-border bg-muted px-3 py-1.5 text-right text-sm text-foreground outline-none focus:border-ring disabled:opacity-50"
      />
      <SaveButton visible={isModified} onClick={save} disabled={disabled} />
    </div>
  );
}

// ── Select dropdown ──────────────────────────────────────────────────────────

function SelectInput({
  value,
  options,
  onSave,
  disabled,
}: { value: string; options: string[]; onSave: (v: string) => void; disabled: boolean }) {
  return (
    <select
      value={value}
      onChange={(e) => onSave(e.target.value)}
      disabled={disabled}
      className="w-44 cursor-pointer rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground outline-none focus:border-ring disabled:opacity-50"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

// ── Text input for strings ───────────────────────────────────────────────────

function StringInput({
  value,
  onSave,
  disabled,
}: { value: string; onSave: (v: string) => void; disabled: boolean }) {
  const [local, setLocal] = useState(value);
  const isModified = local !== value;

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && isModified && onSave(local)}
        disabled={disabled}
        className="w-48 rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground outline-none focus:border-ring disabled:opacity-50"
      />
      <SaveButton visible={isModified} onClick={() => onSave(local)} disabled={disabled} />
    </div>
  );
}

// ── Tag chips for arrays ─────────────────────────────────────────────────────

function TagsInput({
  value,
  onSave,
  disabled,
  presets,
}: {
  value: unknown[];
  onSave: (v: unknown[]) => void;
  disabled: boolean;
  presets?: string[];
}) {
  const [newTag, setNewTag] = useState('');
  const isNumeric = isNumberArray(value);
  const tags = value.map(String);

  function removeTag(index: number) {
    const next = [...value];
    next.splice(index, 1);
    onSave(next);
  }

  function addTag(tag: string) {
    if (!tag.trim()) return;
    const parsed = isNumeric ? Number(tag) : tag.trim();
    if (isNumeric && Number.isNaN(parsed as number)) return;
    if (tags.includes(String(parsed))) return;
    onSave([...value, parsed]);
    setNewTag('');
  }

  // Available presets that aren't already selected
  const available = presets?.filter((p) => !tags.includes(p));

  return (
    <div className="space-y-2">
      {/* Current tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag, i) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
            >
              {tag}
              <button
                type="button"
                onClick={() => !disabled && removeTag(i)}
                disabled={disabled}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-red-400 disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Add from presets or free-text */}
      {available && available.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {available.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => !disabled && addTag(preset)}
              disabled={disabled}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground disabled:opacity-50"
            >
              <Plus className="h-3 w-3" />
              {preset}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            type={isNumeric ? 'number' : 'text'}
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTag(newTag)}
            placeholder={isNumeric ? 'Add number...' : 'Add item...'}
            disabled={disabled}
            className="w-36 rounded-md border border-border bg-muted px-2.5 py-1 text-xs text-foreground outline-none focus:border-ring disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => addTag(newTag)}
            disabled={disabled || !newTag.trim()}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── JSON editor for complex objects ──────────────────────────────────────────

function JsonInput({
  value,
  onSave,
  disabled,
}: { value: unknown; onSave: (v: unknown) => void; disabled: boolean }) {
  const formatted = JSON.stringify(value, null, 2);
  const [local, setLocal] = useState(formatted);
  const [parseError, setParseError] = useState(false);

  const isModified = local !== formatted;

  function save() {
    try {
      const parsed = JSON.parse(local);
      setParseError(false);
      onSave(parsed);
    } catch {
      setParseError(true);
    }
  }

  const lines = Math.min(Math.max(local.split('\n').length, 2), 10);

  return (
    <div className="space-y-1.5">
      <textarea
        value={local}
        onChange={(e) => {
          setLocal(e.target.value);
          setParseError(false);
        }}
        rows={lines}
        disabled={disabled}
        className={cn(
          'w-full rounded-md border bg-muted px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-ring disabled:opacity-50',
          parseError ? 'border-red-500' : 'border-border',
        )}
      />
      <div className="flex items-center gap-2">
        {parseError && <span className="text-xs text-red-400">Invalid JSON</span>}
        <div className="flex-1" />
        <SaveButton visible={isModified} onClick={save} disabled={disabled} />
      </div>
    </div>
  );
}

// ── Shared save button ───────────────────────────────────────────────────────

function SaveButton({
  visible,
  onClick,
  disabled,
}: { visible: boolean; onClick: () => void; disabled: boolean }) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md bg-emerald-500/10 p-1.5 text-emerald-500 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
    >
      <Check className="h-4 w-4" />
    </button>
  );
}
