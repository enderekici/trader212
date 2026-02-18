'use client';
import { useWizard } from '../WizardContext';

export function DryRunStep() {
  const { formData, setField, goNext, goBack } = useWizard();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Dry Run Mode</h2>
        <p className="mt-1 text-gray-400 text-sm">Run the bot without risking real money.</p>
      </div>
      <div className="space-y-3">
        {([true, false] as const).map((val) => (
          <button
            key={String(val)}
            type="button"
            onClick={() => setField('dryRun', val)}
            className={`w-full p-4 rounded-lg border text-left ${
              formData.dryRun === val ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700 hover:border-gray-500'
            }`}
          >
            <div className="font-medium text-white">{val ? 'Dry Run (Recommended)' : 'Live Trading'}</div>
            <div className="text-xs text-gray-500 mt-1">
              {val
                ? 'Simulate trades to test strategy without real money.'
                : 'Execute real trades with your T212 account. Use with caution.'}
            </div>
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
