'use client';
import { WizardProvider, useWizard } from './WizardContext';
import { WelcomeStep } from './steps/Welcome';
import { T212ConnectionStep } from './steps/T212Connection';
import { DryRunStep } from './steps/DryRun';
import { AIProviderStep } from './steps/AIProvider';
import { RiskLimitsStep } from './steps/RiskLimits';
import { PairlistStep } from './steps/Pairlist';
import { NotificationsStep } from './steps/Notifications';
import { StrategyProfileStep } from './steps/StrategyProfile';
import { ReviewStep } from './steps/Review';

const STEPS = [
  WelcomeStep,
  T212ConnectionStep,
  DryRunStep,
  AIProviderStep,
  RiskLimitsStep,
  PairlistStep,
  NotificationsStep,
  StrategyProfileStep,
  ReviewStep,
];

function WizardInner() {
  const { currentStep, totalSteps, close } = useWizard();
  const StepComponent = STEPS[currentStep];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl mx-4 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-700">
          <span className="text-sm text-gray-400">Setup Guide</span>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">
              {currentStep + 1} / {totalSteps}
            </span>
            <button
              type="button"
              onClick={close}
              className="text-gray-500 hover:text-gray-300 text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 py-3">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === currentStep ? 'bg-blue-500' : i < currentStep ? 'bg-blue-800' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="px-6 pb-6">
          <StepComponent />
        </div>
      </div>
    </div>
  );
}

interface Props {
  onClose: () => void;
}

export function SetupWizard({ onClose }: Props) {
  return (
    <WizardProvider onClose={onClose}>
      <WizardInner />
    </WizardProvider>
  );
}
