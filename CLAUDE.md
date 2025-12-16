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
