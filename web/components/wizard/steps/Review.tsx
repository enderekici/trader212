'use client';
import { useState } from 'react';
import { useWizard } from '../WizardContext';
import { api } from '@/lib/api';

export function ReviewStep() {
  const { formData, goBack, close } = useWizard();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLaunch() {
    setSaving(true);
    setError(null);
    try {
      // Save all settings
      const tasks: Promise<unknown>[] = [
        api.updateConfig('execution.dryRun', formData.dryRun),
        api.updateConfig('ai.provider', formData.aiProvider),
        api.updateConfig('risk.maxPositionSizePct', formData.maxPositionSizePct),
        api.updateConfig('risk.dailyLossLimitPct', formData.dailyLossLimitPct),
        api.updateConfig('pairlist.mode', formData.pairlistMode),
        api.updateConfig('telegram.enabled', formData.telegramEnabled),
      ];
      if (formData.telegramEnabled) {
        tasks.push(api.updateConfig('telegram.botToken', formData.telegramBotToken));
        tasks.push(api.updateConfig('telegram.chatId', formData.telegramChatId));
      }
      await Promise.all(tasks);

      // Activate strategy profile
      await fetch(`/api/strategy-profiles/${formData.strategyProfile}/activate`, { method: 'POST' });

      // Mark setup complete in localStorage
      localStorage.setItem('setup_complete', 'true');
      close();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  const rows = [
    { label: 'Mode', value: formData.dryRun ? 'Dry Run (Safe)' : 'Live Trading' },
    { label: 'AI Provider', value: formData.aiProvider },
    { label: 'Max Position', value: `${formData.maxPositionSizePct}%` },
    { label: 'Daily Loss Limit', value: `${formData.dailyLossLimitPct}%` },
    { label: 'Pairlist Mode', value: formData.pairlistMode },
    { label: 'Strategy', value: formData.strategyProfile },
    { label: 'Telegram', value: formData.telegramEnabled ? 'Enabled' : 'Disabled' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Review &amp; Launch</h2>
        <p className="mt-1 text-gray-400 text-sm">Confirm your settings before starting the bot.</p>
      </div>
      <div className="divide-y divide-gray-700 border border-gray-700 rounded-lg overflow-hidden">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between px-4 py-2 text-sm">
            <span className="text-gray-400">{r.label}</span>
            <span className="text-white">{r.value}</span>
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-between">
        <button type="button" onClick={goBack} className="px-4 py-2 text-gray-400 hover:text-white text-sm">
          Back
        </button>
        <button
          type="button"
          onClick={handleLaunch}
          disabled={saving}
          className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Launch Bot'}
        </button>
      </div>
    </div>
  );
}
