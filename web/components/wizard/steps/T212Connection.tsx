'use client';
import { useState } from 'react';
import { useWizard } from '../WizardContext';
import { api } from '@/lib/api';

export function T212ConnectionStep() {
  const { formData, setField, goNext, goBack } = useWizard();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      await api.updateConfig('trading212.apiKey', formData.t212ApiKey);
      const status = await api.getStatus();
      setTestResult(status ? 'ok' : 'fail');
    } catch {
      setTestResult('fail');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Trading212 Connection</h2>
        <p className="mt-1 text-gray-400 text-sm">Enter your Trading212 API key to connect the bot.</p>
      </div>
      <div className="space-y-3">
        <label className="block text-sm text-gray-300">API Key</label>
        <input
          type="password"
          value={formData.t212ApiKey}
          onChange={(e) => setField('t212ApiKey', e.target.value)}
          placeholder="Your Trading212 API key"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <p className="text-xs text-gray-500">Found in T212 app → Settings → API. Keep this secret.</p>
      </div>
      {testResult === 'ok' && <p className="text-sm text-green-400">Connection successful!</p>}
      {testResult === 'fail' && <p className="text-sm text-red-400">Connection failed. Check your API key.</p>}
      <div className="flex justify-between">
        <button type="button" onClick={goBack} className="px-4 py-2 text-gray-400 hover:text-white text-sm">
          Back
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={testConnection}
            disabled={!formData.t212ApiKey || testing}
            className="px-4 py-2 border border-gray-600 text-gray-300 hover:border-gray-500 rounded-lg text-sm disabled:opacity-50"
          >
            {testing ? 'Testing...' : 'Test'}
          </button>
          <button
            type="button"
            onClick={goNext}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
