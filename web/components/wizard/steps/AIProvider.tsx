'use client';
import { useWizard } from '../WizardContext';

const PROVIDERS = [
  { id: 'openai-compatible', label: 'OpenAI / Compatible API', desc: 'GPT-4, Groq, Together, Mistral, local' },
  { id: 'anthropic', label: 'Anthropic Claude', desc: 'Claude Opus, Sonnet, Haiku' },
  { id: 'ollama', label: 'Ollama (local)', desc: 'Run models locally on your machine' },
  { id: 'rules', label: 'Rules Engine (free)', desc: 'Deterministic rules, no AI costs' },
];

export function AIProviderStep() {
  const { formData, setField, goNext, goBack } = useWizard();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">AI Provider</h2>
        <p className="mt-1 text-gray-400 text-sm">Choose how the bot makes trading decisions.</p>
      </div>
      <div className="space-y-2">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setField('aiProvider', p.id)}
            className={`w-full p-3 rounded-lg border text-left ${
              formData.aiProvider === p.id ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700 hover:border-gray-500'
            }`}
          >
            <div className="text-sm font-medium text-white">{p.label}</div>
            <div className="text-xs text-gray-500">{p.desc}</div>
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500">You can configure API keys in Settings after setup.</p>
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
