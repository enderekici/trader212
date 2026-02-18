'use client';
import { useWizard } from '../WizardContext';

export function WelcomeStep() {
  const { formData, setField, goNext } = useWizard();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Welcome to Trader212 Bot</h2>
        <p className="mt-1 text-gray-400 text-sm">Let&apos;s get your trading bot set up in a few minutes.</p>
      </div>
      <div>
        <p className="text-sm text-gray-300 mb-3">Choose your experience level:</p>
        <div className="grid grid-cols-2 gap-3">
          {(['beginner', 'advanced'] as const).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setField('skillLevel', level)}
              className={`p-4 rounded-lg border text-left transition-colors ${
                formData.skillLevel === level
                  ? 'border-blue-500 bg-blue-500/10 text-white'
                  : 'border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              <div className="font-medium capitalize">{level}</div>
              <div className="text-xs mt-1 text-gray-500">
                {level === 'beginner' ? 'Guided setup with explanations' : 'Quick setup, skip explanations'}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={goNext}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm"
        >
          Get Started
        </button>
      </div>
    </div>
  );
}
