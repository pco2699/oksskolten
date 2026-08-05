# Oksskolten Spec — OpenRouter LLM Provider

> [Back to Overview](./01_overview.md)

## Overview

OpenRouter is the only LLM provider. It is a hosted gateway that exposes models from many vendors (Anthropic, OpenAI, Google, Meta, Mistral, DeepSeek, …) behind a single OpenAI-compatible API and a single API key, and it serves summarization, translation, chat, and feed inference. The direct Anthropic, Gemini, OpenAI, Claude Code, Ollama, and vLLM providers, along with the Google Translate and DeepL translation services, were removed in favour of it.

## Motivation

- **One key, many models**: Every major vendor is reachable without registering separately with each and storing several API keys.
- **Model coverage**: Models no static list could keep up with (Llama, Mistral, DeepSeek, Qwen, and vendor previews) are selectable, and new releases need no code change.
- **One code path**: A single OpenAI-compatible adapter replaces four chat adapters, six LLM providers, and two translation services — less code, fewer SDKs, one set of failure modes.
- **Fallback and routing**: OpenRouter transparently handles upstream outages and per-model routing, which a self-hosted reader cannot do on its own.

## Design

### OpenAI-Compatible API

OpenRouter serves `/chat/completions` in the OpenAI format. The provider uses the `openai` npm package with `baseURL` pointing at the OpenRouter API root — the only LLM SDK the project still depends on, after `@anthropic-ai/sdk` and `@google/genai` were dropped.

### Provider Registration

`server/providers/llm/index.ts` registers exactly one provider; `getProvider()` throws `Unknown LLM provider` for anything else. `shared/models.ts` exports `LLM_PROVIDER = 'openrouter'` and no static model lists.

- **Provider key**: `openrouter`
- **API key**: Required. `requireKey()` throws `OPENROUTER_KEY_NOT_SET` when `api_key.openrouter` is unset.
- **Base URL**: `OPENROUTER_BASE_URL` environment variable, falling back to `https://openrouter.ai/api/v1`. Trailing slashes are stripped. There is no DB setting for the URL: OpenRouter is a hosted service with one canonical endpoint, and the environment variable exists only for corporate gateways and proxies.
- **Attribution headers**: `HTTP-Referer` and `X-Title` are sent as `defaultHeaders`. OpenRouter uses them to attribute traffic to the calling app; they are optional for the API itself and contain no user data.
- **Client cache**: The client is re-created when the base URL or API key changes.

### Dynamic Model Discovery

OpenRouter's catalog changes continuously and holds hundreds of models, so a static list in `shared/models.ts` would go stale. Models are discovered at runtime:

```
GET {base_url}/models
```

Response shape (relevant fields):

```json
{
  "data": [
    {
      "id": "anthropic/claude-sonnet-4.5",
      "name": "Anthropic: Claude Sonnet 4.5",
      "pricing": { "prompt": "0.000003", "completion": "0.000015" }
    }
  ]
}
```

The server maps each entry to `{ name: id, label: name, vendor, pricing? }`, where `vendor` is the segment before `/` in the model id (`other` when the id has no slash), and sorts by id. The result is cached in memory for 6 hours — the catalog changes a few times a week, so a stale read beats a fetch per view — and a failed fetch keeps serving the last good copy. The frontend renders one `SelectGroup` per vendor so the long list stays navigable.

### Token Usage and Billing

OpenRouter returns `usage.prompt_tokens` and `usage.completion_tokens` in the OpenAI-compatible response; missing usage records zeros. `AiBillingMode` in `server/fetcher/ai.ts` is now just `'openrouter'`, and the `monthly_chars` field that tracked Google Translate and DeepL free tiers is gone from the usage payload.

Cost estimates come from the same catalog as the model list. `/models` reports prices per token as decimal strings; the server converts them to $/M tokens and stores them on each `CatalogModel`. The `useModelCatalog()` hook feeds `use-metrics.ts` and `chat-message-bubble.tsx`, which show `~$X` when the model has a known price and omit the cost otherwise — free models and ids missing from the catalog simply show tokens and elapsed time. There is no hardcoded fallback rate, so no estimate is ever invented.

### Chat Adapter

`adapter.ts` has no routing left to do: `runChatTurn(params)` delegates straight to `runOpenRouterTurn()` in `adapter-openrouter.ts` (the former `adapter-openai.ts`, repointed at the OpenRouter client). The Anthropic, Gemini, and Claude Code adapters were deleted along with `toAnthropicTools()` / `toGeminiTools()`.

Tool calling depends on the selected model — models without tool support answer without invoking Oksskolten's chat tools.

The standalone MCP server (`server/chat/mcp-server.ts`) is unaffected: it exposes the same tool layer to Claude Code over stdio and never touched the chat providers.

### Configuration

The API key is stored in the settings DB under `api_key.openrouter` and managed through the provider API key endpoints. The `chat.provider`, `summary.provider`, and `translate.provider` keys no longer exist — with one provider there is nothing to select — and neither do the `ollama.*` / `vllm.base_url` keys.

| Setting Key | Type | Default | Description |
|---|---|---|---|
| `api_key.openrouter` | string | `""` | OpenRouter API key (`sk-or-v1-...`) |
| `chat.model` | string | `""` | OpenRouter model id (e.g. `anthropic/claude-sonnet-4.5`) |
| `summary.model` | string | `""` | OpenRouter model id |
| `summary.reasoning` | `on` / `off` | `off` | Let the model think before summarizing |
| `translate.model` | string | `""` | OpenRouter model id |
| `translate.reasoning` | `on` / `off` | `off` | Let the model think before translating |

`OPENROUTER_BASE_URL` is an environment variable, not a DB setting.

Nothing falls back to a built-in model. `POST /api/chat` returns 400 `MODEL_NOT_SET` when `chat.model` is empty, and summarize/translate throw `MODEL_NOT_SET`, which `articles.ts` surfaces as a known error code the frontend translates. Feed inference in `rss-bridge.ts` borrows `chat.model`, falling back to `summary.model`, and is disabled when neither is set.

### Settings UI

The provider section holds a single `OpenRouterCard`: API key state (configured / not set), a password input, a delete button, and a "Test Connection" button calling `GET /api/settings/openrouter/status`. The provider button group is gone — there is nothing to pick — so each task row is just a model field plus, for summary and translation, a max-tokens override and a reasoning switch.

The model is entered as free text (e.g. `deepseek/deepseek-v4-flash`), because OpenRouter adds models faster than any cached catalog reflects. Below the text field, a dropdown populated from `GET /api/settings/openrouter/models` and grouped by vendor fills the same value. Nothing is auto-selected: the catalog is large and paid, so the id is always an explicit choice.

### Model Validation

`PREF_ALLOWED` for `chat.model` / `summary.model` / `translate.model` is `null` (any string). Cross-checking a model against a provider's static list no longer applies, so `validateProviderModel()` and `PROVIDER_MODEL_PAIRS` were removed from `server/routes/settings.ts`. An unknown id surfaces as a 404 from OpenRouter at call time.

### `shared/models.ts` Changes

The file shrank to what a single-provider setup needs:

- `LLM_PROVIDER` — the provider key, used wherever a provider name is required.
- `TASK_DEFAULTS` — per-task defaults, with empty model strings.
- `PROVIDER_LABELS` — one entry, `provider.openrouter`.
- `CatalogModel` / `ModelPricing` types plus `getModelLabel(model, catalog)` and `getModelPricing(model, catalog)`, which now read from a fetched catalog instead of hardcoded tables.
- Removed: `ANTHROPIC_MODELS`, `GEMINI_MODELS`, `OPENAI_MODELS`, `MODELS_BY_PROVIDER`, `DEFAULT_MODELS`, `SUB_AGENT_MODELS`, `LLM_API_PROVIDERS`, `LLM_TASK_PROVIDERS`, `TRANSLATE_SERVICE_PROVIDERS`, `getModelValues()`, `getAllModelValues()`.

Conversation titles are generated with the same model as the conversation (there is no cheap sub-agent model to fall back to), so `generateConversationTitle()` takes a model id rather than a provider name.

### API Endpoints

**List OpenRouter Models** — `GET /api/settings/openrouter/models`

Proxies `GET {base_url}/models` and returns the mapped list. Returns `{ "models": [] }` if OpenRouter is unreachable. Response: `{ "models": [{ "name": "anthropic/claude-sonnet-4.5", "label": "Anthropic: Claude Sonnet 4.5", "vendor": "anthropic" }] }`

**Test OpenRouter Connection** — `GET /api/settings/openrouter/status`

Calls `GET {base_url}/key` and `GET {base_url}/models` in parallel. `/models` is public, so `/key` is what actually verifies the stored API key. Response: `{ "ok": true, "model_count": 327, "label": "My Key", "limit_remaining": 4.21 }` or `{ "ok": false, "error": "HTTP 401" }`

### Error Handling

| Scenario | Behavior |
|---|---|
| API key not set | `requireKey()` throws `OPENROUTER_KEY_NOT_SET`; task fails with the standard missing-key error |
| Model not configured | `MODEL_NOT_SET` — 400 from `POST /api/chat`, known error code from summarize/translate |
| API key invalid | OpenRouter returns 401; surfaced as provider error. "Test Connection" reports `HTTP 401` |
| Out of credits | OpenRouter returns 402; surfaced as provider error |
| Model id unavailable | OpenRouter returns 404; surfaced as provider error |
| Upstream provider rate-limited | OpenRouter returns 429; surfaced as provider error |
| Model list fetch fails | `/api/settings/openrouter/models` returns `{ models: [] }`; UI shows "Cannot connect to OpenRouter" |
| Token usage missing | Record `0` for both input and output tokens |
| Streaming interrupted | Same handling as the OpenAI provider (partial text returned) |

### Test Plan

- **Unit tests** (`server/providers/llm/openrouter.test.ts`): default and env-overridden base URL, trailing-slash stripping, API key lookup, `requireKey()` throwing and passing, `createMessage()` request shape and token counts, `streamMessage()` delta accumulation and usage.
- **Integration**: Manual test with a real OpenRouter key — summarize, translate, and chat against at least one model — plus "Test Connection" with a valid and an invalid key. Not required for CI, since it needs a live key.

### Out of Scope

- **Model id migration**: Model ids stored under the old providers (e.g. `claude-haiku-4-5-20251001`) are not rewritten to OpenRouter ids; they stay in the DB until the user picks a new model, and a stale id fails with a 404 from OpenRouter. Migration `0009_openrouter_only.sql` does delete the dead API keys, provider selections, and Ollama/vLLM/translation-usage rows.
- **Provider routing preferences**: OpenRouter's `provider` routing options (order, fallbacks, data policies) are not configurable; defaults apply.
- **BYOK / model-specific parameters**: Bring-your-own-key routing and per-model sampling parameters follow the same limitation as other providers.
- **Model id validation**: A typed model id is not checked against the catalog before saving; an unknown id surfaces as a 404 from OpenRouter at call time.

### Key Files

| File | Purpose |
|---|---|
| `server/providers/llm/openrouter.ts` | OpenRouter LLM provider implementation |
| `server/providers/llm/index.ts` | Register `openrouter` in the provider map |
| `server/chat/adapter.ts` | Add `openrouter` routing case |
| `server/fetcher/ai.ts` | Add `'openrouter'` to `AiBillingMode` union |
| `shared/models.ts` | Add OpenRouter to provider constants and label map |
| `server/routes/settings.ts` | Preference keys, API key map, OpenRouter API endpoints |
| `server/chat/adapter.ts` | Single entry point to the OpenRouter adapter |
| `src/hooks/use-model-catalog.ts` | SWR hook serving the catalog to model pickers and cost display |
| `src/pages/settings/sections/provider-config-section.tsx` | Add `OpenRouterCard` component |
| `src/pages/settings/sections/task-model-section.tsx` | Vendor-grouped dynamic model selector, configuredKeys |
| `src/lib/i18n.ts` | Add `provider.openrouter` and OpenRouter-related i18n keys |
| `server/providers/llm/openrouter.test.ts` | Unit tests for the OpenRouter provider |
| `migrations/0009_openrouter_only.sql` | Delete settings rows belonging to the removed providers |
