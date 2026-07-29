-- OpenRouter is now the only LLM provider. Drop settings that belonged to the
-- removed providers so stale API keys are not left sitting in the database with
-- no UI to delete them, and so provider keys stop shadowing the new model-only
-- configuration. Model ids are left alone: the user picks a new one in Settings.
DELETE FROM settings WHERE key IN (
  'api_key.anthropic',
  'api_key.gemini',
  'api_key.openai',
  'api_key.vllm',
  'api_key.google_translate',
  'api_key.deepl',
  'chat.provider',
  'summary.provider',
  'translate.provider',
  'ollama.base_url',
  'ollama.custom_headers',
  'vllm.base_url',
  'google_translate.usage_month',
  'google_translate.usage_chars',
  'deepl.usage_month',
  'deepl.usage_chars'
);
