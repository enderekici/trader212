'use client';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export type SkillLevel = 'beginner' | 'advanced';

export interface WizardFormData {
  skillLevel: SkillLevel;
  t212ApiKey: string;
  dryRun: boolean;
  aiProvider: string;
  maxPositionSizePct: number;
  dailyLossLimitPct: number;
  pairlistMode: string;
  staticSymbols: string;
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  strategyProfile: string;
}

interface WizardContextValue {
  currentStep: number;
  totalSteps: number;
  formData: WizardFormData;
  skillLevel: SkillLevel;
  setField: <K extends keyof WizardFormData>(key: K, value: WizardFormData[K]) => void;
  goNext: () => void;
  goBack: () => void;
  close: () => void;
}

const WizardContext = createContext<WizardContextValue | null>(null);

export function useWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard must be used within WizardProvider');
  return ctx;
}

const TOTAL_STEPS = 9;

const defaultFormData: WizardFormData = {
  skillLevel: 'beginner',
  t212ApiKey: '',
  dryRun: true,
  aiProvider: 'openai-compatible',
  maxPositionSizePct: 10,
  dailyLossLimitPct: 5,
  pairlistMode: 'dynamic',
  staticSymbols: '',
  telegramEnabled: false,
  telegramBotToken: '',
  telegramChatId: '',
  strategyProfile: 'Balanced',
};

interface Props {
  children: ReactNode;
  onClose: () => void;
}

export function WizardProvider({ children, onClose }: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<WizardFormData>(defaultFormData);

  const setField = useCallback(<K extends keyof WizardFormData>(key: K, value: WizardFormData[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  }, []);

  const goNext = useCallback(() => {
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }, []);

  const goBack = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }, []);

  return (
    <WizardContext.Provider
      value={{ currentStep, totalSteps: TOTAL_STEPS, formData, skillLevel: formData.skillLevel, setField, goNext, goBack, close: onClose }}
    >
      {children}
    </WizardContext.Provider>
  );
}
