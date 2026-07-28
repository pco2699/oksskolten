# Oksskolten Spec — OpenRouter LLM Provider

> [Back to Overview](./01_overview.md)

## Overview

Add OpenRouter as an LLM provider. OpenRouter is a hosted gateway that exposes models from many vendors (Anthropic, OpenAI, Google, Meta, Mistral, DeepSeek, …) behind a single OpenAI-compatible API and a single API key, and is used for summarization, translation, and chat like any other provider.

## Motivation

- **One key, many models**: Users can reach models from every major vendor without registering for each provider separately and storing several API keys.
- **Model coverage**: Models Oksskolten does not carry in its static lists (Llama, Mistral, DeepSeek, Qwen, and vendor previews) become selectable.
- **Fallback and routing**: OpenRouter transparently handles provider outages and per-model routing, which a self-hosted reader cannot do on its own.
- **Low integration cost**: The API is OpenAI-compatible, so the existing `openai` SDK and chat adapter are reused unchanged.

## Design

### OpenAI-Compatible API

OpenRouter serves `/chat/completions` in the OpenAI format. The provider reuses the `openai` npm package with `baseURL` pointing at the OpenRouter API root, exactly like the Ollama and vLLM providers. No new SDK dependency is added.

### Provider Registration

- **Provider key**: `openrouter`
- **API key**: Required. `requireKey()` throws `OPENROUTER_KEY_NOT_SET` when `api_key.openrouter` is unset, matching the Anthropic/Gemini/OpenAI providers.
- **Base URL**: `OPENROUTER_BASE_URL` environment variable, falling back to `https://openrouter.ai/api/v1`. Trailing slashes are stripped. Unlike Ollama and vLLM there is no DB setting for the URL: OpenRouter is a hosted service with one canonical endpoint, and the environment variable exists only for corporate gateways and proxies.
- **Attribution headers**: `HTTP-Referer` and `X-Title` are sent as `defaultHeaders`. OpenRouter uses them to attribute traffic to the calling app; they are optional for the API itself and contain no user data.
- **Client cache**: The client is re-created when the base URL or API key changes, the same cache key pattern as the other providers.

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

The server maps each entry to `{ name: id, label: name, vendor }`, where `vendor` is the segment before `/` in the model id (`other` when the id has no slash), and sorts by id. The frontend renders one `SelectGroup` per vendor so the long list stays navigable.

### Token Usage and Billing

OpenRouter returns `usage.prompt_tokens` and `usage.completion_tokens` in the OpenAI-compatible response, recorded like every other provider; missing usage records zeros. `AiBillingMode` in `server/fetcher/ai.ts` is extended with `'openrouter'`.

Per-model pricing is not resolved locally. `getModelPricing()` returns `undefined` for OpenRouter model ids because `MODELS_BY_PROVIDER` has no `openrouter` entry, so the UI shows no cost estimate — the same behavior as Ollama and vLLM. Actual spend is visible in the OpenRouter dashboard.

### Chat Adapter

`adapter.ts` routes `openrouter` to `runOpenAITurn()` with the OpenRouter client passed as `externalClient`, reusing the tool loop and streaming path already shared with Ollama and vLLM. No `adapter-openrouter.ts` is needed. Tool calling depends on the selected model — models without tool support answer without invoking Oksskolten's chat tools.

### Configuration

The API key is stored in the settings DB under `api_key.openrouter` and managed through the existing provider API key endpoints. No new preference key is introduced.

| Setting Key | Type | Default | Description |
|---|---|---|---|
| `api_key.openrouter` | string | `""` | OpenRouter API key (`sk-or-v1-...`) |
| `chat.provider` | string | — | Set to `openrouter` to use OpenRouter for chat |
| `chat.model` | string | — | OpenRouter model id (e.g. `anthropic/claude-sonnet-4.5`) |
| `summary.provider` | string | — | Set to `openrouter` for summarization |
| `summary.model` | string | — | OpenRouter model id |
| `translate.provider` | string | — | Set to `openrouter` for translation |
| `translate.model` | string | — | OpenRouter model id |

`OPENROUTER_BASE_URL` is an environment variable, not a DB setting.

### Settings UI

- An `OpenRouterCard` component under the LLM provider section. It shows the API key state (configured / not set), a password input to save a key, a delete button, and a "Test Connection" button calling `GET /api/settings/openrouter/status`.
- When `openrouter` is selected for a task, the model is entered as free text (e.g. `deepseek/deepseek-v4-flash`), because OpenRouter adds models faster than any cached catalog reflects. Below the text field, a dropdown populated from `GET /api/settings/openrouter/models` and grouped by vendor fills the same value. Nothing is auto-selected: the catalog is large and paid, so the id is always an explicit choice.

Unlike Ollama and vLLM, OpenRouter is only enabled in the provider button group once a key is stored: `configuredKeys['openrouter']` reflects `/api/settings/api-keys/openrouter`.

### Model Validation

`openrouter` joins `ollama` and `vllm` in `DYNAMIC_MODEL_PROVIDERS` in `server/routes/settings.ts`. `validateProviderModel()` skips the static model list for those providers, and the `PREF_ALLOWED` check for `chat.model` / `summary.model` / `translate.model` is bypassed when the paired provider is dynamic, so ids like `anthropic/claude-sonnet-4.5` are accepted.

### `shared/models.ts` Changes

- Add `openrouter` to `DEFAULT_MODELS` with an empty string (no static default).
- Add `openrouter` to `PROVIDER_LABELS` with label key `provider.openrouter` (`"OpenRouter"` in all languages).
- Add `openrouter` to `LLM_TASK_PROVIDERS`.
- Add `openrouter` to `SUB_AGENT_MODELS` with an empty string, which disables sub-agent title generation for this provider (`generateConversationTitle()` returns early on an empty model).
- `openrouter` is **not** added to `LLM_API_PROVIDERS`, since that list drives the static-model UI, and **not** to `MODELS_BY_PROVIDER`.

### API Endpoints

**List OpenRouter Models** — `GET /api/settings/openrouter/models`

Proxies `GET {base_url}/models` and returns the mapped list. Returns `{ "models": [] }` if OpenRouter is unreachable. Response: `{ "models": [{ "name": "anthropic/claude-sonnet-4.5", "label": "Anthropic: Claude Sonnet 4.5", "vendor": "anthropic" }] }`

**Test OpenRouter Connection** — `GET /api/settings/openrouter/status`

Calls `GET {base_url}/key` and `GET {base_url}/models` in parallel. `/models` is public, so `/key` is what actually verifies the stored API key. Response: `{ "ok": true, "model_count": 327, "label": "My Key", "limit_remaining": 4.21 }` or `{ "ok": false, "error": "HTTP 401" }`

### Error Handling

| Scenario | Behavior |
|---|---|
| API key not set | `requireKey()` throws `OPENROUTER_KEY_NOT_SET`; task fails with the standard missing-key error |
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

- **Cost display**: Per-model pricing from `/models` is fetched but not surfaced; token cost estimates are not shown for OpenRouter models.
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
| `server/routes/settings.ts` | Allowed provider values, API key map, OpenRouter API endpoints |
| `src/pages/settings/sections/provider-config-section.tsx` | Add `OpenRouterCard` component |
| `src/pages/settings/sections/task-model-section.tsx` | Vendor-grouped dynamic model selector, configuredKeys |
| `src/lib/i18n.ts` | Add `provider.openrouter` and OpenRouter-related i18n keys |
| `server/providers/llm/openrouter.test.ts` | Unit tests for the OpenRouter provider |
