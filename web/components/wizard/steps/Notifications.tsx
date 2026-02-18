'use client';
import { useWizard } from '../WizardContext';

export function NotificationsStep() {
  const { formData, setField, goNext, goBack } = useWizard();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Notifications</h2>
        <p className="mt-1 text-gray-400 text-sm">Get trade alerts on Telegram.</p>
      </div>
      <div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.telegramEnabled}
            onChange={(e) => setField('telegramEnabled', e.target.checked)}
            className="w-4 h-4 accent-blue-500"
          />
          <span className="text-sm text-gray-300">Enable Telegram notifications</span>
        </label>
      </div>
      {formData.telegramEnabled && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Bot Token</label>
            <input
              type="password"
              value={formData.telegramBotToken}
              onChange={(e) => setField('telegramBotToken', e.target.value)}
              placeholder="From @BotFather"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Chat ID</label>
            <input
              type="text"
              value={formData.telegramChatId}
              onChange={(e) => setField('telegramChatId', e.target.value)}
              placeholder="Your Telegram chat ID"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
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
