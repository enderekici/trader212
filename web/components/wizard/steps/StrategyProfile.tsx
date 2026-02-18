'use client';
import { useWizard } from '../WizardContext';

const PROFILES = [
  { id: 'conservative', label: 'Conservative', desc: 'Low risk, smaller positions, tight stops' },
  { id: 'balanced', label: 'Balanced (Recommended)', desc: 'Moderate risk, balanced approach' },
  { id: 'aggressive', label: 'Aggressive', desc: 'Higher risk tolerance, larger positions' },
  { id: 'scalper', label: 'Scalper', desc: 'Short-term trades, quick entries/exits' },
  { id: 'swing', label: 'Swing Trader', desc: 'Multi-day holds, trend following' },
];

export function StrategyProfileStep() {
  const { formData, setField, goNext, goBack } = useWizard();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Strategy Profile</h2>
        <p className="mt-1 text-gray-400 text-sm">Choose a pre-configured strategy to start with.</p>
      </div>
      <div className="space-y-2">
        {PROFILES.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setField('strategyProfile', p.id)}
            className={`w-full p-3 rounded-lg border text-left ${
              formData.strategyProfile === p.id
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-gray-700 hover:border-gray-500'
            }`}
          >
            <div className="text-sm font-medium text-white">{p.label}</div>
            <div className="text-xs text-gray-500">{p.desc}</div>
          </button>
        ))}
      </div>
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
