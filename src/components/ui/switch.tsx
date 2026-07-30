interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  /** Text shown next to the switch. The whole row is clickable. */
  label: string
  /** Optional explanation rendered under the row. */
  description?: string
}

/**
 * Labelled on/off switch. The knob is intentionally white in both themes —
 * it reads as a physical toggle rather than a themed surface, matching the
 * switches in the settings screens.
 */
export function Switch({ checked, onCheckedChange, disabled, label, description }: SwitchProps) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-3 cursor-pointer">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => onCheckedChange(!checked)}
          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${
            checked ? 'bg-accent' : 'bg-border'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              checked ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
        <span className="text-xs text-text select-none">{label}</span>
      </label>
      {description && <p className="text-xs text-muted">{description}</p>}
    </div>
  )
}
