# Oksskolten Spec — Chat

> [Back to Overview](./01_overview.md)

## Overview

Interactive chat feature. Users can search articles, analyze content, and get recommendations using natural language.

## Motivation

A core feature of Oksskolten. Enables natural-language interaction with the article database — ask questions about specific articles, perform cross-feed search, get reading recommendations, and trigger actions (summarize, translate, bookmark) through conversation.

## Design

### Architecture

Chat runs against OpenRouter through one adapter. The same tool definitions back both the web chat and the standalone MCP server.

```
┌──────────────────────────────────────────────────────────────────┐
│  Docker Container                                                │
│                                                                  │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────┐      │
│  │ Fastify  │───▶│ ChatService  │───▶│  Tool layer       │      │
│  │ API      │    │ (adapter)    │    │  (server/chat)    │      │
│  └──────────┘    └──────┬───────┘    └─────────┬─────────┘      │
│                         │                      │                 │
│                         ▼                      ▼                 │
│                 ┌──────────────┐         ┌────────┐             │
│                 │  OpenRouter  │         │ SQLite │             │
│                 │   Adapter    │         │        │             │
│                 └──────┬───────┘         └────────┘             │
│                        │                                         │
│  ┌───────────────┐     │                                         │
│  │  MCP Server   │─────┘  (stdio, for Claude Code)               │
│  └───────────────┘                                               │
└────────────────────────┼─────────────────────────────────────────┘
                         ▼
                  OpenRouter API
```

| Path | Communication | Notes |
|---|---|---|
| **Web chat** | Fastify → OpenRouter (`/chat/completions`, tools as function calling) | SSE streaming, up to 10 tool rounds |
| **MCP server (stdio)** | `server/chat/mcp-server.ts` over stdio | Exposes the same tools to Claude Code against the local DB |
| **MCP server (HTTP)** | `POST /mcp` (Streamable HTTP) | Same tools, for remote clients (Claude Desktop via `mcp-remote`) against the deployed instance |

The model is set in the settings UI (`chat.model`); there is no backend to choose.

### File Structure

```
server/chat/
├── adapter.ts                 # Entry point: runChatTurn()
├── adapter-openrouter.ts      # OpenRouter (OpenAI-compatible) adapter
├── tool-loop.ts               # Shared tool execution loop
├── history.ts                 # Conversation history normalization/repair
├── mcp-factory.ts             # Shared McpServer factory (tool registration, used by both transports below)
├── mcp-server.ts              # MCP stdio entrypoint (npx tsx server/chat/mcp-server.ts)
└── tools.ts                   # Tool definitions (ToolDef neutral format)

server/routes/
└── mcp.ts                     # MCP Streamable HTTP endpoint (POST /mcp)
```

### MCP Tools

Tool definitions are managed in a neutral `ToolDef` format in `server/chat/tools.ts` and converted to the chat-completions function format via `toOpenAITools()`.

| Tool Name | Description | Input |
|---|---|---|
| `search_articles` | Search articles (Meilisearch full-text search, feed, category, date range, unread/liked/bookmarked) | `{ query?, feed_id?, category_id?, unread?, liked?, bookmarked?, since?, until?, limit? }` |
| `get_article` | Get article details (including full_text, full_text_ja). Adds `fetch_status` / `fetch_status_detail` when the stored body is a fetch-failure page | `{ article_id }` |
| `get_similar_articles` | Search for articles similar to a given article via Meilisearch | `{ article_id, limit? }` |
| `get_user_preferences` | Get user reading preferences (top feeds, categories, recent likes/bookmarks, per-category read rate, ignored feeds) | `{}` |
| `get_recent_activity` | Get user's recent activity in chronological order (read/liked/bookmarked) | `{ type?, limit? }` |
| `get_feeds` | Get feed list (with article count and unread count) | `{}` |
| `get_categories` | Get category list | `{}` |
| `get_reading_stats` | Get reading statistics | `{ since?, until? }` |
| `mark_as_read` | Mark an article as seen | `{ article_id }` |
| `toggle_like` | Toggle an article's like status | `{ article_id }` |
| `toggle_bookmark` | Toggle an article's bookmark status | `{ article_id }` |
| `summarize_article` | Summarize an article (checks cache before execution) | `{ article_id }` |
| `summarize_articles` | Summarize up to 20 articles (checks cache per article) | `{ article_ids }` |
| `translate_article` | Translate an article (checks cache before execution) | `{ article_id }` |

#### Refusing fetch-failure pages

A page fetch intercepted by a bot check, a cookie-consent screen, or a login wall still yields extractable prose, and stored in `full_text` it is indistinguishable from an article. Summarizing it produced confident descriptions of pages such as "YouTube's unusual-traffic confirmation screen" — a plausible lie the caller could not tell apart from success.

`summarize_article`, `summarize_articles`, and `translate_article` therefore classify the stored body first (`detectBlockedBody`, `server/lib/blocked-body.ts`) and return an error instead of a summary:

```json
{ "id": 4550, "error": "Stored body is a bot-check page, not article content", "fetch_status": "bot_check" }
```

- `fetch_status` is one of `bot_check`, `consent_wall`, `login_wall`, `error_page`, `too_short`.
- The check runs **before** the cached summary/translation, because anything cached for such an article was generated from the same block page.
- `too_short` (body under `MIN_EXTRACTED_LENGTH`, 200 chars) applies to summarization only — there is nothing to summarize in a body shorter than the summary, while a short body translates fine.
- Markers are matched only in the first 2000 characters, so an article that merely quotes a CAPTCHA page is not flagged.
- `get_article` still returns the body, but labels it with `fetch_status` / `fetch_status_detail` so an agent does not read it as the article.

The same classifier drives the fetch pipeline's bot-block detection, so the fetcher and the tools agree on what counts as a failed fetch.

The MCP server (`server/chat/mcp-server.ts`) starts with stdio transport when executed directly, and is connected to by Claude Code. Tool registration itself lives in `server/chat/mcp-factory.ts`, shared with the HTTP endpoint (`server/routes/mcp.ts`) — both transports expose the exact same tool set.

### Using the MCP Server with Claude Code

The MCP server can be used directly from Claude Code, giving you the same chat experience as the web UI. The data directory resolves in this order:

1. `DATA_DIR` environment variable
2. `./data` (project checkout or Docker container)
3. `~/.oksskolten/data/` (standalone fallback)

#### Option 1: Local development (Node.js required)

The repository includes `.mcp.json`, so cloning the repo and running `npm install` is all that's needed. Claude Code will automatically discover and connect to the MCP server.

```json
// .mcp.json (included in repository)
{
  "mcpServers": {
    "oksskolten": {
      "command": "npx",
      "args": ["tsx", "server/chat/mcp-server.ts"]
    }
  }
}
```

#### Option 2: Docker one-liner (no Node.js required)

Install the MCP server globally with a single command:

```bash
claude mcp add --scope user --transport stdio oksskolten \
  -- docker run -i --rm -v ~/.oksskolten/data:/app/data babarot/oksskolten \
  npx tsx server/chat/mcp-server.ts
```

This makes the RSS reader tools available from any project. Data is stored in `~/.oksskolten/data/`.

Alternatively, add the following to your Claude Code MCP settings (`~/.claude.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "oksskolten": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "~/.oksskolten/data:/app/data",
        "babarot/oksskolten",
        "npx", "tsx", "server/chat/mcp-server.ts"
      ]
    }
  }
}
```

#### Option 3: SSH into production server

When the app is running via `docker compose up` in production with `DATA_DIR=$HOME/.oksskolten/data` in `.env`, you can SSH into the server and run `claude` to query articles through the MCP server. The MCP server reads the same `~/.oksskolten/data/rss.db` that the Docker container writes to (SQLite WAL mode allows concurrent readers).

Setup on the production server:

```bash
# Install the MCP server (run once)
claude mcp add --scope user --transport stdio oksskolten \
  -- docker run -i --rm -v ~/.oksskolten/data:/app/data babarot/oksskolten \
  npx tsx server/chat/mcp-server.ts
```

Then from any directory:

```bash
ssh prod-server
claude  # MCP tools are available immediately
```

#### Option 4: Local Claude Code → remote production server

Connect your local Claude Code to a production server's database without SSH-ing in. This wraps SSH as a stdio transport — the remote Docker container's stdin/stdout becomes the MCP channel.

```bash
claude mcp add --scope user --transport stdio oksskolten \
  -- ssh prod-server docker run -i --rm \
  -v ~/.oksskolten/data:/app/data babarot/oksskolten \
  npx tsx server/chat/mcp-server.ts
```

Requires SSH key authentication (password prompts break stdio).

#### Option 5: Claude Desktop (or any Streamable HTTP client) via `mcp-remote`

`POST /mcp` exposes the same tools over the [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), reachable at the deployed instance's public URL — no SSH or local Node.js checkout required. Since Claude Desktop only speaks stdio, wrap the endpoint with [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "oksskolten": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://rss.pco2699.xyz/mcp",
        "--header",
        "Authorization: Bearer ok_..."
      ]
    }
  }
}
```

Create the token from Settings → Security → API Tokens (see [API Token Endpoints](./20_api.md)). A `read`-scoped token can use every read-only tool; write-mutating tools (`mark_as_read`, `mark_articles_as_read`, `toggle_like`, `toggle_bookmark`, `summarize_article`, `summarize_articles`, `translate_article`) additionally require `read,write` scope, matching the same scope model as `/api/*`.

The endpoint runs in **stateless** Streamable HTTP mode: every request gets a fresh `McpServer` + transport (`sessionIdGenerator: undefined`), so there is no server-side session state to manage. `GET`/`DELETE /mcp` (server-initiated notifications / session termination in stateful mode) return `405`, since neither applies without sessions.

### OpenRouter Adapter

`server/chat/adapter-openrouter.ts`. Streams via `chat.completions.create({ stream: true })` on the OpenRouter client and executes up to 10 rounds of tool loops.

- Throws `OPENROUTER_KEY_NOT_SET` when no API key is stored; `POST /api/chat` returns 400 `MODEL_NOT_SET` when no model is configured
- Streamed tool-call deltas are accumulated per index before execution
- Collects tool results and loops back
- SSE events: `text_delta`, `thinking_start`, `reasoning_delta`, `thinking_end`, `tool_use_start`, `tool_use_end`, `done`, `error`
- Tool support depends on the chosen model — models without tool calling simply answer without invoking tools

Unlike summarization and translation, chat leaves reasoning at the model's own default — deliberation earns its cost in a conversation. Reasoning tokens arrive on a `delta.reasoning` field outside the OpenAI schema; the adapter emits `thinking_start` on the first one, streams each as `reasoning_delta`, and emits `thinking_end` when the answer begins (or when a round ends having only called tools). The client renders the reasoning live, so a thinking model shows progress rather than appearing frozen. Reasoning text is never appended to the assistant message that gets stored.

### Search Architecture

The `search_articles` tool combines Meilisearch full-text search with structured filters.

```
User: "What was that Cloudflare article I read last week?"
                │
                ▼
┌──────────────────────────────┐
│  LLM (Claude)                │
│  Natural language → structured│
│  query decomposition          │
└──────────┬───────────────────┘
           ▼
┌───────────────────────────────────────┐
│  search_articles tool                 │
│  1. With query → Meilisearch FTS      │
│     - feed_id/category_id/since/until │
│       → Meilisearch filter            │
│     - unread/liked/bookmarked         │
│       → SQLite post-filter            │
│  2. Without query → SQLite WHERE      │
└───────────────────────────────────────┘
```

**Meilisearch search**: Searches across `title`, `full_text`, and `full_text_ja` with typo-tolerant, relevance-ranked full-text search. Falls back to SQLite LIKE when the search index is not built.

### DB Schema

See [10_schema.md](./10_schema.md) for the `conversations` / `chat_messages` schema.

The `content` column stores neutral content blocks as JSON (text, `tool_use`, `tool_result`). The adapter converts them to the chat-completions message shape when resuming a conversation.

| Case | `article_id` | `title` |
|---|---|---|
| Normal chat | `NULL` | Auto-generated from the first message |
| In-article chat | Article ID | Article title as initial value |

### API Endpoints

#### `POST /api/chat`

Send a chat message and return the response as an SSE stream.

```
Request:
  { "message": "...", "conversation_id?": "uuid", "article_id?": 123 }

Response: SSE stream
  data: { "type": "conversation_id", "conversation_id": "uuid" }
  data: { "type": "thinking_start" }
  data: { "type": "reasoning_delta", "text": "The user is asking about" }
  data: { "type": "thinking_end" }
  data: { "type": "text_delta", "text": "This week's" }
  data: { "type": "tool_use_start", "name": "search_articles" }
  data: { "type": "tool_use_end", "name": "search_articles" }
  data: { "type": "done" }
```

Processing flow:
1. If no `conversation_id`, create a new conversation (generate UUID)
2. Retrieve past messages from DB and repair conversation history consistency
3. Execute a chat turn with the selected backend (streaming via SSE)
4. Save user message and assistant response to `chat_messages`
5. Auto-generate conversation title from the first message

#### `GET /api/chat/conversations`

Get conversation list. Can filter by in-article chats with `?article_id=123`.

#### `GET /api/chat/:id/messages`

Get message list for a conversation (filters out `tool_use` / `tool_result` for display).

#### `DELETE /api/chat/:id`

Delete a conversation and its messages (`ON DELETE CASCADE`).

#### `GET /api/chat/suggestions`

Get suggestions to start a conversation. Dynamically generated based on time of day (morning/afternoon/evening), unread count, and reading preferences.

```json
// Response: 200
{
  "suggestions": [
    { "key": "suggestion.morning.newArticles" },
    { "key": "suggestion.unreadMany", "params": { "count": 55 } },
    { "key": "suggestion.topCategory", "params": { "category": "Tech" } }
  ]
}
```

`key` is an i18n key. The frontend converts it to display text via `t()`.

#### `GET /api/settings/api-keys/:provider`

Check API key configuration status. `provider` must be `openrouter`. Returns `{ configured: boolean }`.

#### `POST /api/settings/api-keys/:provider`

Save or delete the OpenRouter API key. `{ apiKey?: string }` (empty to delete).

#### `GET /api/settings/openrouter/models`

Return the cached OpenRouter model catalog (id, label, vendor, pricing).

### Frontend

#### ChatPanel Component

Shared between Home chat and in-article chat.

```typescript
interface ChatPanelProps {
  variant: 'full' | 'inline'
  articleId?: number
  conversationId?: string
  onConversationCreated?: (id: string) => void
}
```

| variant | Usage | Display |
|---|---|---|
| `full` | For ChatPage | Full height |
| `inline` | For in-article Callout | Max 400px, expandable via portal (close with Esc) |

- `useChat()` hook manages messages, streaming state, and conversation ID
- Enter to send, Shift+Enter for newline
- Displays tool name during tool execution
- In-article chat auto-loads existing conversation by `article_id`

#### ChatPage (`/chat`)

Conversation list in the left sidebar, `ChatPanel` (variant=`full`) on the right.

- Create, select, and delete conversations
- Routing via `/chat/:conversationId`
- Conversation list with date display

#### ChatFab (Floating Chat UI)

The `ChatFab` component displays a floating button at the bottom-right of the article detail screen.

- Click to open `ChatPanel` (variant=`inline`) inline
- Shows a badge icon when the article has an existing conversation
- On desktop, auto-opens the panel when an existing conversation exists
- State is preserved when toggling panel visibility

#### In-Article Chat

`ChatFab` is placed in the `ArticleDetail` component. When an article has an existing conversation, the chat panel opens automatically. The system prompt includes the article title and summary before being sent to the LLM.

#### Settings Page

AI and translation settings section (`/settings/integration` tab):

**Per-task settings**:
- **Chat / Summary / Translation**: Each takes an OpenRouter model id, typed as free text or picked from the vendor-grouped catalog. The three are independent
- **Max output tokens**: Summary and translation each accept an override

**API key management**:
- OpenRouter: set/delete the key, configuration status indicator, and a "Test Connection" button that verifies the key against `GET /key`
- Translation target language selector

Settings are persisted in DB as `chat.model`, `summary.model`, `translate.model`. The API key is stored as `api_key.openrouter`.
