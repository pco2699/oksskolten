import { useState, useCallback } from 'react'
import useSWR from 'swr'
import { fetcher, apiPost } from '../../../lib/fetcher'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import type { Settings } from '../../../hooks/use-settings'

type TFunc = (key: any, params?: Record<string, string>) => string

export function ProviderConfigSection({ t, settings }: { t: TFunc; settings: Settings }) {
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-text mb-1">{t('integration.llmProviderConfig')}</h2>
        <p className="text-xs text-muted mb-4">{t('integration.llmProviderConfigDesc')}</p>
        <div className="space-y-3">
          <OpenRouterCard t={t} />
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium text-text mb-1">{t('settings.translateTargetLang')}</h3>
        <p className="text-xs text-muted mb-3">{t('settings.translateTargetLangDesc')}</p>
        <div className="flex rounded-md bg-bg-subtle p-0.5">
          {([
            { value: '', label: t('settings.translateTargetLangAuto') },
            { value: 'ja', label: t('settings.languageJa') },
            { value: 'en', label: t('settings.languageEn') },
            { value: 'zh', label: t('settings.languageZh') },
          ] as const).map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => settings.setTranslateTargetLang(opt.value)}
              className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors select-none ${
                (settings.translateTargetLang || '') === opt.value
                  ? 'bg-accent text-accent-text font-medium shadow-sm'
                  : 'text-muted hover:text-text'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

function OpenRouterCard({ t }: { t: TFunc }) {
  const { data: keyStatus, mutate: mutateKeyStatus } = useSWR<{ configured: boolean }>(
    '/api/settings/api-keys/openrouter',
    fetcher,
    { revalidateOnFocus: false },
  )

  const isConfigured = keyStatus?.configured

  const [apiKeyInput, setApiKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; model_count?: number; error?: string } | null>(null)

  function showMessage(text: string, type: 'success' | 'error') {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  const handleSave = useCallback(async () => {
    if (saving || !apiKeyInput) return
    setSaving(true)
    try {
      await apiPost('/api/settings/api-keys/openrouter', { apiKey: apiKeyInput })
      void mutateKeyStatus()
      setApiKeyInput('')
      showMessage(t('openrouter.apiKeySaved'), 'success')
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }, [saving, apiKeyInput, mutateKeyStatus, t])

  const handleDeleteKey = useCallback(async () => {
    if (saving) return
    setSaving(true)
    try {
      await apiPost('/api/settings/api-keys/openrouter', { apiKey: '' })
      void mutateKeyStatus()
      setTestResult(null)
      showMessage(t('openrouter.apiKeyDeleted'), 'success')
    } catch (err: unknown) {
      showMessage(err instanceof Error ? err.message : 'Delete failed', 'error')
    } finally {
      setSaving(false)
    }
  }, [saving, mutateKeyStatus, t])

  const handleTest = useCallback(async () => {
    if (testing) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetcher('/api/settings/openrouter/status') as { ok: boolean; model_count?: number; error?: string }
      setTestResult(res)
    } catch {
      setTestResult({ ok: false, error: 'Request failed' })
    } finally {
      setTesting(false)
    }
  }, [testing])

  return (
    <div className="p-3 rounded-lg bg-bg-card border border-border min-h-[3rem] space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${isConfigured ? 'bg-success' : 'bg-error'}`} />
          <span className="text-sm font-medium text-text select-none">{t('provider.openrouter')}</span>
          <span className="text-xs text-muted select-none">
            {isConfigured ? t('chat.apiKeyConfigured') : t('chat.apiKeyNotSet')}
          </span>
        </div>
        {isConfigured && (
          <button
            type="button"
            onClick={handleDeleteKey}
            disabled={saving}
            className="px-3 py-1 text-xs rounded-lg border border-border text-muted hover:text-text hover:bg-hover transition-colors disabled:opacity-50 select-none"
          >
            {t('chat.apiKeyDelete')}
          </button>
        )}
      </div>

      {!isConfigured && (
        <FormField label={t('chat.apiKey')} hint={t('openrouter.apiKeyDesc')} compact>
          <div className="flex items-center gap-2">
            <Input
              type="password"
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
              placeholder="sk-or-v1-..."
              className="flex-1 py-1.5"
            />
            {apiKeyInput && (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity disabled:opacity-50 select-none"
              >
                {saving ? '...' : t('settings.save')}
              </button>
            )}
          </div>
        </FormField>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted hover:text-text hover:bg-hover transition-colors disabled:opacity-50 select-none"
        >
          {testing ? t('openrouter.testing') : t('openrouter.testConnection')}
        </button>
        {testResult && (
          <span className={`text-xs ${testResult.ok ? 'text-accent' : 'text-error'}`}>
            {testResult.ok
              ? `${t('openrouter.connected')} (${testResult.model_count} models)`
              : `${t('openrouter.connectionFailed')}: ${testResult.error}`}
          </span>
        )}
      </div>

      {message && (
        <p className={`text-xs ${message.type === 'error' ? 'text-error' : 'text-accent'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
