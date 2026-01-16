# Granola Sync

Export your [Granola](https://granola.ai) meeting notes to Markdown files.

> Based on reverse engineering research by [Joseph Thacker](https://josephthacker.com/hacking/2025/05/08/reverse-engineering-granola-notes.html)

## Install

Requires [Bun](https://bun.sh) and macOS.

```bash
bun install -g github:jcpsimmons/reverse-engineering-granola-api
```

## Usage

```bash
# Sync all documents
granola-sync ./output

# Last week only
granola-sync ./output --since 'last week'

# Last 2 weeks
granola-sync ./output --since 'last 2 weeks'

# Specific date range
granola-sync ./output --since 2025-01-01 --until 2025-01-31
```

**Date formats:**
- ISO8601: `2025-01-15`
- Relative: `today`, `yesterday`, `last week`, `last month`
- Patterns: `last 7 days`, `last 2 weeks`, `last 3 months`

## What it does

1. Launches Granola (if needed) to extract auth tokens
2. Fetches your documents from the Granola API
3. Saves each document as Markdown with metadata and transcripts

**Output structure:**
```
output/
├── workspaces.json
├── document_lists.json
├── {document_id}/
│   ├── document.json      # Raw API data
│   ├── metadata.json      # Workspace, folders, dates
│   ├── resume.md          # Your notes as Markdown
│   ├── transcript.json    # Raw transcript
│   └── transcript.md      # Formatted transcript
```

## Update / Uninstall

```bash
# Update
bun install -g github:jcpsimmons/reverse-engineering-granola-api

# Uninstall
bun remove -g reverse-engineering-granola-api
```

---

## MCP Server

Search your synced meetings from Claude Desktop or Claude Code.

### Setup

1. Sync your documents first:
   ```bash
   granola-sync ~/granola-docs
   ```

2. Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "granola": {
         "command": "bun",
         "args": ["run", "/path/to/repo/src/mcp-server.ts"],
         "env": {
           "GRANOLA_SYNC_DIR": "/Users/you/granola-docs"
         }
       }
     }
   }
   ```

3. Restart Claude

### Example queries

```
"Show me meetings from last week"
"Find meetings with joe@example.com"
"Meetings about product launch"
"Get the transcript from yesterday's standup"
```

### Available tools

| Tool | Description |
|------|-------------|
| `search_meetings` | Search by attendee, date, workspace, folder, or content |
| `get_meeting_details` | Full notes for a specific meeting |
| `get_meeting_transcript` | Formatted transcript |
| `refresh_cache` | Reload attendee data |

---

## Other Commands

These require cloning the repo:

```bash
git clone https://github.com/jcpsimmons/reverse-engineering-granola-api
cd reverse-engineering-granola-api
bun install

# List workspaces
bun run list-workspaces

# List folders
bun run list-folders

# Filter by workspace
bun run filter-by-workspace ./output --workspace-name "Sales"

# Filter by folder
bun run filter-by-folder ./output --folder-name "Clients"
```

---

## API Documentation

<details>
<summary>Click to expand API details</summary>

### Authentication

Granola uses WorkOS OAuth 2.0 with **refresh token rotation** - each token is single-use.

**Token exchange:**
```
POST https://api.workos.com/user_management/authenticate

{
  "client_id": "...",
  "grant_type": "refresh_token",
  "refresh_token": "..."
}
```

Response includes new `access_token` and rotated `refresh_token` (must be saved).

### Endpoints

All requests require:
```
Authorization: Bearer {access_token}
User-Agent: Granola/5.354.0
X-Client-Version: 5.354.0
```

| Endpoint | Description |
|----------|-------------|
| `POST /v2/get-documents` | Paginated document list (owned docs only) |
| `POST /v1/get-documents-batch` | Batch fetch by IDs (includes shared docs) |
| `POST /v1/get-document-transcript` | Get transcript for a document |
| `POST /v1/get-workspaces` | List workspaces/organizations |
| `POST /v2/get-document-lists` | List folders |

### Key limitations

- `get-documents` does NOT return shared documents
- Use `get-document-lists` + `get-documents-batch` for shared docs
- No server-side date filtering (filter client-side)

</details>

---

## Development

```bash
# Clone and install
git clone https://github.com/jcpsimmons/reverse-engineering-granola-api
cd reverse-engineering-granola-api
bun install

# Run locally
bun run src/main.ts ./output --since 'last week'

# Run MCP server in dev mode
bun run mcp-dev
```

## License

MIT
