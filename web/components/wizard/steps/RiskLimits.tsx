'use client';
import { useWizard } from '../WizardContext';

export function RiskLimitsStep() {
  const { formData, setField, goNext, goBack } = useWizard();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Risk Limits</h2>
        <p className="mt-1 text-gray-400 text-sm">Define how much risk the bot can take.</p>
      </div>
      <div className="space-y-5">
        <div>
          <div className="flex justify-between mb-1">
            <label className="text-sm text-gray-300">Max position size</label>
            <span className="text-sm text-blue-400">{formData.maxPositionSizePct}%</span>
          </div>
          <input
            type="range"
            min={2}
            max={25}
            value={formData.maxPositionSizePct}
            onChange={(e) => setField('maxPositionSizePct', Number(e.target.value))}
            className="w-full accent-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">Max % of portfolio for a single position.</p>
        </div>
        <div>
          <div className="flex justify-between mb-1">
            <label className="text-sm text-gray-300">Daily loss limit</label>
            <span className="text-sm text-blue-400">{formData.dailyLossLimitPct}%</span>
          </div>
          <input
            type="range"
            min={1}
            max={20}
            value={formData.dailyLossLimitPct}
            onChange={(e) => setField('dailyLossLimitPct', Number(e.target.value))}
            className="w-full accent-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">Bot pauses if daily losses exceed this %.</p>
        </div>
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
