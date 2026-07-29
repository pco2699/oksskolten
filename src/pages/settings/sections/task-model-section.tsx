import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '../../../lib/fetcher'
import { useModelCatalog } from '../../../hooks/use-model-catalog'
import type { CatalogModel } from '../../../data/aiModels'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import type { Settings } from '../../../hooks/use-settings'
import type { TranslateFn } from '../../../lib/i18n'

type TFunc = TranslateFn
type MessageKey = Parameters<TFunc>[0]

interface TaskConfig {
  labelKey: MessageKey
  modelValue: string
  setModel: (v: string) => void
  maxTokensValue?: string
  setMaxTokens?: (v: string) => void
  defaultMaxTokens?: number
}

const SWR_KEY_OPTS = { revalidateOnFocus: false } as const

export function TaskModelSection({ settings, t }: { settings: Settings; t: TFunc }) {
  const { data: openrouterKey } = useSWR<{ configured: boolean }>(
    '/api/settings/api-keys/openrouter', fetcher, SWR_KEY_OPTS,
  )
  const keyLoading = !openrouterKey
  const hasKey = !!openrouterKey?.configured

  const tasks: TaskConfig[] = [
    {
      labelKey: 'integration.task.chat',
      modelValue: settings.chatModel || '',
      setModel: settings.setChatModel,
    },
    {
      labelKey: 'integration.task.summary',
      modelValue: settings.summaryModel || '',
      setModel: settings.setSummaryModel,
      maxTokensValue: settings.summaryMaxTokens || '',
      setMaxTokens: settings.setSummaryMaxTokens,
      defaultMaxTokens: 2048,
    },
    {
      labelKey: 'integration.task.translate',
      modelValue: settings.translateModel || '',
      setModel: settings.setTranslateModel,
      maxTokensValue: settings.translateMaxTokens || '',
      setMaxTokens: settings.setTranslateMaxTokens,
      defaultMaxTokens: 16384,
    },
  ]

  // Show brief "Saved" feedback on any task model change
  const [showSaved, setShowSaved] = useState(false)
  const prevValues = useRef(tasks.map(t => `${t.modelValue}:${t.maxTokensValue ?? ''}`).join('|'))
  const currentValues = tasks.map(t => `${t.modelValue}:${t.maxTokensValue ?? ''}`).join('|')
  useEffect(() => {
    if (prevValues.current !== currentValues) {
      prevValues.current = currentValues
      setShowSaved(true)
      const timer = setTimeout(() => setShowSaved(false), 1500)
      return () => clearTimeout(timer)
    }
  }, [currentValues])

  return (
    <section>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-base font-semibold text-text">{t('integration.taskSettings')}</h2>
        <span
          className={`text-xs text-accent transition-opacity duration-300 ${
            showSaved ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {t('settings.saved')}
        </span>
      </div>
      <p className="text-xs text-muted mb-4">{t('integration.taskSettingsDesc')}</p>
      <div className={`space-y-3 ${!keyLoading && !hasKey ? 'opacity-50 pointer-events-none' : ''}`}>
        {tasks.map(task => (
          <TaskModelRow key={task.labelKey} task={task} t={t} />
        ))}
      </div>
      {!keyLoading && !hasKey && (
        <p className="text-xs text-muted mt-2">{t('integration.taskSettingsNoKeys')}</p>
      )}
    </section>
  )
}

/* ── Task Model Row ── */

function TaskModelRow({ task, t }: { task: TaskConfig; t: TFunc }) {
  return (
    <div className="p-3 rounded-lg bg-bg-card border border-border space-y-2">
      <span className="block text-xs font-medium text-text select-none">{t(task.labelKey)}</span>
      <ModelSelect modelValue={task.modelValue} setModel={task.setModel} t={t} />
      {task.setMaxTokens && <MaxTokensInput task={task} t={t} />}
    </div>
  )
}

/* ── Max Tokens Input ── */

const MAX_TOKENS_LIMIT = 200000

function MaxTokensInput({ task, t }: { task: TaskConfig; t: TFunc }) {
  const onChange = (raw: string) => {
    // Digits only; strip leading zeros so '0' clears back to the default.
    // Clamp to the server-side limit so the debounced PATCH never gets a 400.
    const digits = raw.replace(/\D/g, '').replace(/^0+/, '')
    task.setMaxTokens!(digits ? String(Math.min(Number(digits), MAX_TOKENS_LIMIT)) : '')
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <span className="block text-[11px] text-text select-none">{t('integration.maxTokens')}</span>
        <span className="block text-[11px] text-muted/70 select-none">{t('integration.maxTokensDesc')}</span>
      </div>
      <Input
        type="text"
        inputMode="numeric"
        value={task.maxTokensValue ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={String(task.defaultMaxTokens)}
        className="w-24 text-right shrink-0"
        aria-label={t('integration.maxTokens')}
      />
    </div>
  )
}

/* ── Model selection ── */

function groupByVendor(models: CatalogModel[]): Array<[string, CatalogModel[]]> {
  const byVendor = new Map<string, CatalogModel[]>()
  for (const m of models) {
    const list = byVendor.get(m.vendor)
    if (list) list.push(m)
    else byVendor.set(m.vendor, [m])
  }
  return [...byVendor.entries()]
}

function ModelSelect({ modelValue, setModel, t }: { modelValue: string; setModel: (v: string) => void; t: TFunc }) {
  const { models } = useModelCatalog()

  // OpenRouter adds models constantly, so the id is typed directly. The dropdown
  // below is a picker over the live catalog, not the only way in.
  return (
    <div className="space-y-2">
      <Input
        type="text"
        value={modelValue}
        onChange={e => setModel(e.target.value.trim())}
        placeholder={t('openrouter.modelIdPlaceholder')}
        spellCheck={false}
        aria-label={t('openrouter.modelId')}
      />
      <span className="block text-[11px] text-muted/70 select-none">{t('openrouter.modelIdDesc')}</span>
      {models.length === 0 ? (
        <Select disabled>
          <SelectTrigger>
            <SelectValue placeholder={t('openrouter.noModels')} />
          </SelectTrigger>
          <SelectContent />
        </Select>
      ) : (
        <Select value={models.some(m => m.name === modelValue) ? modelValue : undefined} onValueChange={setModel}>
          <SelectTrigger>
            <SelectValue placeholder={t('openrouter.pickFromCatalog')} />
          </SelectTrigger>
          <SelectContent>
            {groupByVendor(models).map(([vendor, vendorModels]) => (
              <SelectGroup key={vendor}>
                <SelectLabel>{vendor}</SelectLabel>
                {vendorModels.map(m => (
                  <SelectItem key={m.name} value={m.name}>{m.label} ({m.name})</SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
