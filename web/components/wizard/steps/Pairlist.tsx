'use client';
import { useWizard } from '../WizardContext';

export function PairlistStep() {
  const { formData, setField, goNext, goBack } = useWizard();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Stock Selection</h2>
        <p className="mt-1 text-gray-400 text-sm">How should the bot discover stocks to trade?</p>
      </div>
      <div className="space-y-2">
        {[
          { id: 'dynamic', label: 'Dynamic (Recommended)', desc: 'Auto-discover US stocks matching your filters' },
          { id: 'static', label: 'Static', desc: 'Only trade the symbols you specify' },
          { id: 'hybrid', label: 'Hybrid', desc: 'Your symbols + auto-discovered stocks' },
        ].map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setField('pairlistMode', m.id)}
            className={`w-full p-3 rounded-lg border text-left ${
              formData.pairlistMode === m.id ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700 hover:border-gray-500'
            }`}
          >
            <div className="text-sm font-medium text-white">{m.label}</div>
            <div className="text-xs text-gray-500">{m.desc}</div>
          </button>
        ))}
      </div>
      {(formData.pairlistMode === 'static' || formData.pairlistMode === 'hybrid') && (
        <div>
          <label className="block text-sm text-gray-300 mb-1">Symbols (comma-separated)</label>
          <input
            type="text"
            value={formData.staticSymbols}
            onChange={(e) => setField('staticSymbols', e.target.value)}
            placeholder="AAPL, MSFT, TSLA"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      )}
      <div className="flex justify-between">
        <button type="button" onClick={goBack} className="px-4 py-2 text-gray-400 hover:text-white text-sm">
          Back
        </button>
        <button type="button" onClick={goNext} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm">
          Next
        </button>
      </div>
    </div>
  );
}
