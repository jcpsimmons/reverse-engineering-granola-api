# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a reverse engineering project for the Granola API, written in TypeScript and running with Bun. The project provides tools to extract, fetch, and convert Granola meeting notes/documents into Markdown format with associated metadata and transcripts.

## Development Commands

**Main operations:**
```bash
# Fetch all documents and save to output directory
bun run src/main.ts /path/to/output/directory
# or use the shorthand:
bun run main /path/to/output/directory

# List all workspaces (organizations)
bun run src/list-workspaces.ts
# or: bun run list-workspaces

# List all document lists (folders)
bun run src/list-folders.ts
# or: bun run list-folders

# Filter documents by workspace
bun run src/filter-by-workspace.ts /path/to/output --list-workspaces
bun run src/filter-by-workspace.ts /path/to/output --workspace-id <id>
bun run src/filter-by-workspace.ts /path/to/output --workspace-name "Name"

# Filter documents by folder
bun run src/filter-by-folder.ts /path/to/output --list-folders
bun run src/filter-by-folder.ts /path/to/output --folder-id <id>
bun run src/filter-by-folder.ts /path/to/output --folder-name "Name"
bun run src/filter-by-folder.ts /path/to/output --no-folder
```

## Architecture

### Token Management & Authentication Flow

**Critical security concept: Refresh token rotation**
- Granola uses WorkOS OAuth 2.0 with single-use refresh tokens
- Each token exchange invalidates the old refresh token and issues a new one
- `TokenManager` (src/token-manager.ts) handles this rotation automatically
- After each successful token refresh, the new tokens MUST be saved to config.json
- Access tokens expire after 1 hour (3600 seconds)
- Token expiry check includes 5-minute buffer for safety

**Automatic token extraction (macOS only):**
- `granola-automation.ts` manages the Granola app lifecycle
- Extracts tokens from `~/Library/Application Support/Granola/supabase.json`
- Launches Granola if not running, extracts tokens, then closes it
- Client ID is extracted from JWT access token's "iss" field using pattern `/client_[a-zA-Z0-9_-]+$/`

### API Client Architecture

**src/api-client.ts** contains all Granola API interactions:

**Key endpoints:**
- `POST /v2/get-documents` - Paginated document fetching (does NOT return shared documents)
- `POST /v1/get-documents-batch` - Batch fetch by document IDs (DOES return shared documents)
- `POST /v1/get-workspaces` - Fetch workspaces (organizations)
- `POST /v2/get-document-lists` or `/v1/get-document-lists` - Fetch folders (try v2 first, fallback to v1)
- `POST /v1/get-document-transcript` - Fetch transcript for a document

**Important API patterns:**
- All requests require `Authorization: Bearer {token}`, `User-Agent: Granola/5.354.0`, and `X-Client-Version: 5.354.0` headers
- Response formats vary between endpoints (e.g., `docs` vs `documents`, `name` vs `title`)
- The code handles multiple response formats gracefully
- Pagination uses `limit` and `offset` parameters
- Document lists can contain `document_ids` (v1) or full `documents` objects (v2)

**Shared documents limitation:**
- `get-documents` endpoint only returns documents owned by the user
- To fetch shared documents, use `get-document-lists` to get folder contents, then `get-documents-batch` to fetch the actual documents

### Data Conversion

**src/converters.ts** handles format conversions:

**ProseMirror to Markdown:**
- Recursive traversal of ProseMirror JSON document structure
- Supports: headings (with levels), paragraphs, bullet lists, text nodes
- Each document's `last_viewed_panel.content` contains the ProseMirror data

**Transcript formatting:**
- Converts utterance arrays to formatted markdown
- Distinguishes between "microphone" and "system" audio sources
- Extracts timestamps from ISO8601 strings, formats as `[HH:MM:SS]`

### Data Flow in main.ts

1. **Configuration setup**: Check for config.json, auto-extract tokens if missing
2. **Token management**: Load config, obtain valid access token (refresh if expired)
3. **Fetch workspaces**: Build map of workspace_id → workspace_name
4. **Fetch document lists**: Build map of document_id → array of folders
5. **Fetch documents**: Paginate through all documents with `include_last_viewed_panel: true`
6. **Save raw data**: Store `workspaces.json`, `document_lists.json`, `granola_api_response.json`
7. **Process each document**:
   - Create folder named by document ID
   - Save `document.json` (raw document data)
   - Fetch and save transcript (`transcript.json`)
   - Build and save `metadata.json` (includes workspace, folders, meeting date, sources)
   - Convert ProseMirror to Markdown and save `resume.md`
   - Convert transcript to Markdown and save `transcript.md`

### Output Structure

```
output_directory/
├── workspaces.json              # All workspace data
├── document_lists.json          # All folder data
├── granola_api_response.json    # Raw API response
└── {document_id}/
    ├── document.json            # Full document object
    ├── metadata.json            # Structured metadata
    ├── resume.md                # Document content as Markdown
    ├── transcript.json          # Raw utterances (if available)
    └── transcript.md            # Formatted transcript (if available)
```

### Key Relationships

**Workspaces (Organizations):**
- Each document belongs to exactly one workspace via `workspace_id`
- Workspaces contain multiple documents and document lists

**Document Lists (Folders):**
- Documents can belong to multiple lists (many-to-many)
- Lists are workspace-specific
- Documents can exist without being in any list

**Transcripts:**
- Not all documents have transcripts (returns 404 if missing)
- Transcripts contain utterances with source, text, timestamps, and confidence scores
- First utterance's timestamp becomes the `meeting_date` in metadata

## Implementation Patterns

**Error handling:**
- API errors log to console but don't crash the entire sync
- If individual document processing fails, continue with remaining documents
- Fallback patterns for different API versions (v1/v2)

**Bun-specific features:**
- Uses `Bun.file()` for file operations with async/await
- Uses `Bun.write()` for writing files
- Uses `$` from "bun" for shell commands (granola-automation.ts)

**Type safety:**
- All API responses have TypeScript interfaces
- Graceful handling of optional fields with `?.` operator
- Response format variations handled with type unions

---

## MCP Server Architecture

The codebase includes an **MCP (Model Context Protocol) server** that enables Claude Code and Claude Desktop to search Granola documents using natural language queries.

### Running the MCP Server

```bash
# Run the MCP server
bun run mcp-server

# Development mode with auto-reload
bun run mcp-dev
```

**Environment variables:**
- `GRANOLA_SYNC_DIR` (required) - Path to synced documents directory
- `GRANOLA_CACHE_PATH` (optional) - Override Granola cache location

### MCP Server Components

**Core modules (src/):**

1. **`mcp-server.ts`** - Main MCP server entry point
   - Initializes DocumentCache on startup
   - Registers 4 MCP tools: search_meetings, get_meeting_details, get_meeting_transcript, refresh_cache
   - Uses stdio transport for MCP protocol
   - Error handling wraps all tool calls

2. **`document-cache.ts`** - In-memory document index
   - Loads all metadata.json files from sync directory
   - Parses Granola cache file for attendee data
   - Builds 5 indexes: attendee (email), date, workspace, folder (name), title tokens
   - Provides fast O(1) lookups for multi-dimensional queries
   - Lazy-loads transcripts from disk (performance optimization)

3. **`cache-parser.ts`** - Granola cache file parser
   - Parses `~/Library/Application Support/Granola/cache-v3.json`
   - Extracts attendee emails, names, organizer status, conference data
   - Gracefully handles missing/malformed cache (degrades without attendees)
   - Flexible schema handling for different cache versions

4. **`document-search.ts`** - Multi-dimensional search algorithm
   - Combines filters using Set intersections (AND logic)
   - Filter order: attendee → date → workspace → folder → content
   - Relevance scoring: title match (10), recency (0-5), folders (0.5 each), attendees (+1)
   - Content search loads transcripts on-demand for performance

5. **`date-parser.ts`** - Relative date parsing
   - Converts natural language dates to Date objects
   - Supported: "yesterday", "last week", "last month", "last N days/weeks/months"
   - ISO8601 passthrough: "2025-01-15"
   - Server-side parsing simplifies client (Claude doesn't need date math)

### MCP Tools

**1. search_meetings** - Primary search tool
- Parameters: attendee_email, start_date, end_date, workspace_id, folder_name, content_query, limit, include_transcript
- Returns: Array of matches with metadata, snippets, relevance scores
- Query summary explains which filters were applied
- Example: `{attendee_email: "joe", start_date: "last week", limit: 5}`

**2. get_meeting_details** - Retrieve full meeting data
- Parameter: document_id
- Returns: Complete document with notes markdown, metadata, attendees
- Includes resume.md content in "notes" field

**3. get_meeting_transcript** - Get formatted transcript
- Parameter: document_id
- Returns: Markdown-formatted transcript with speakers and timestamps
- Returns error if transcript unavailable

**4. refresh_cache** - Reload attendee data
- No parameters
- Re-parses cache-v3.json without restarting server
- Returns updated cache statistics

### Data Flow

**Initialization (on server start):**
1. Parse Granola cache file → attendee data Map<docId, CacheMeeting>
2. Load all metadata.json files → Map<docId, Metadata>
3. Enrich documents with cache data → EnrichedDocument[]
4. Build search indexes (attendee, date, workspace, folder, token)

**Search query flow:**
1. Parse relative dates to Date objects
2. Apply each filter as Set intersection: `result = attendee ∩ date ∩ workspace ∩ folder`
3. For remaining docs, calculate relevance scores (async for transcript search)
4. Sort by score (descending), limit results
5. Load resume.md snippets (first 200 chars)
6. Optionally load full transcripts if requested

**Cache refresh flow:**
1. Re-parse cache-v3.json
2. Re-enrich all documents with new attendee data
3. Rebuild attendee index only (other indexes unchanged)

### Key Design Decisions

**Why hybrid approach (sync dir + cache file)?**
- Sync dir provides documents, transcripts, basic metadata (fast to load)
- Cache file adds attendee data not available via API (complete data)
- No API calls during queries (offline capable, privacy-preserving)
- Graceful degradation if cache unavailable (works without attendees)

**Why in-memory indexes?**
- Metadata is small (~1KB per document), fits in memory for 1000s of docs
- Set intersections are O(1) for multi-filter queries
- Transcripts loaded on-demand (lazy) to save memory
- Startup <2 seconds for 1000 documents

**Why Set intersections for filtering?**
- Simple AND logic: every filter must match
- Efficient: O(min(setA.size, setB.size)) per intersection
- Easy to understand and debug
- Alternative (OR logic) would return too many irrelevant results

**Why server-side date parsing?**
- Claude can use natural language without date calculations
- Consistent date interpretation (no client-side ambiguity)
- Easier to test and validate edge cases
- Reduces prompt complexity for Claude

### Integration with Claude

When configured as an MCP server, Claude Code/Desktop can:
- Query meetings by attendee: "meetings with joe@example.com"
- Filter by date: "meetings from last week"
- Search content: "meetings about pricing"
- Combine filters: "meetings with Sarah last month about Q4 planning"

Claude will automatically:
1. Choose appropriate MCP tool (usually search_meetings)
2. Extract filter parameters from natural language query
3. Call tool with structured parameters
4. Format results for user presentation

### Performance Characteristics

**Startup time:**
- 1000 documents: ~1-2 seconds (load metadata, build indexes)
- 10,000 documents: ~10-15 seconds (linear scaling)

**Query time:**
- Metadata-only filters: <50ms (index lookups)
- Content search (titles): <100ms (token matching)
- Content search (transcripts): <500ms (lazy-load JSON files)

**Memory usage:**
- Base: ~10MB (code + dependencies)
- Per 1000 docs (metadata only): ~10MB
- Per 1000 transcripts (if loaded): ~50-100MB

**Optimization opportunities:**
- LRU cache for frequently accessed transcripts
- Streaming large result sets instead of returning all at once
- Full-text search index for transcript content (currently linear scan)
