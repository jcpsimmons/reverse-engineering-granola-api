# Granola API Reverse Engineering

Reverse-engineered documentation of the Granola API, including authentication flow and endpoints.

**Now written in TypeScript and runs with [Bun](https://bun.sh)!**

## Credits

This work builds upon the initial reverse engineering research by Joseph Thacker:
- [Reverse Engineering Granola Notes](https://josephthacker.com/hacking/2025/05/08/reverse-engineering-granola-notes.html)

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime installed
- macOS (for automatic token extraction)
- Granola app installed

### Installation

No installation needed! Just run the scripts with Bun:

```bash
bun run src/main.ts /path/to/output/directory
```

The script will automatically:
1. Launch Granola (if not running)
2. Extract the necessary tokens from Granola's data files
3. Close Granola
4. Fetch your documents and save them

### Manual Token Configuration (Optional)

If you prefer to manually configure tokens or if automatic extraction fails:

1. Copy the template:
   ```bash
   cp config.json.template config.json
   ```

2. Add your tokens to `config.json` (see `GETTING_REFRESH_TOKEN.md` for details)

## Token Management

### OAuth 2.0 Refresh Token Flow

Granola uses WorkOS for authentication with refresh token rotation.

**Authentication Flow:**

1. **Initial Authentication**

   - Requires `refresh_token` from WorkOS authentication flow
   - Requires `client_id` to identify the application to WorkOS

2. **Access Token Exchange**

   - Refresh token is exchanged for short-lived `access_token` via WorkOS `/user_management/authenticate` endpoint
   - Request: `client_id`, `grant_type: "refresh_token"`, current `refresh_token`
   - Response: new `access_token`, rotated `refresh_token`, `expires_in` (3600 seconds)

3. **Token Rotation (IMPORTANT)**
   - **Refresh tokens CANNOT be reused** - each token is valid for ONE use only
   - Each exchange automatically invalidates the old refresh token and issues a new one
   - You MUST save and use the new refresh token from each response for the next request
   - Attempting to reuse an old refresh token will result in authentication failure
   - This rotation mechanism prevents token replay attacks
   - Access tokens expire after 1 hour

## Implementation Files

All files are written in TypeScript and located in the `src/` directory:

- `src/main.ts` - Document fetching and conversion logic (includes workspace, folder, and batch fetching)
- `src/token-manager.ts` - OAuth token management and refresh
- `src/granola-automation.ts` - Automatic Granola app control and token extraction (macOS only)
- `src/api-client.ts` - Granola API client methods
- `src/converters.ts` - ProseMirror to Markdown conversion utilities
- `src/list-workspaces.ts` - List all available workspaces (organizations)
- `src/list-folders.ts` - List all document lists (folders)
- `src/filter-by-workspace.ts` - Filter and organize documents by workspace
- `src/filter-by-folder.ts` - Filter and organize documents by folder

Legacy Python files (`*.py`) have been removed in favor of TypeScript implementation.

## API Endpoints

### Authentication

#### Refresh Access Token

Exchanges a refresh token for a new access token using WorkOS authentication.

**Endpoint:** `POST https://api.workos.com/user_management/authenticate`

**Request Body:**

```json
{
  "client_id": "string", // WorkOS client ID
  "grant_type": "refresh_token", // OAuth 2.0 grant type
  "refresh_token": "string" // Current refresh token
}
```

**Response:**

```json
{
  "access_token": "string", // New JWT access token
  "refresh_token": "string", // New refresh token (rotated - MUST be saved for next use)
  "expires_in": 3600, // Token lifetime in seconds
  "token_type": "Bearer"
}
```

**IMPORTANT - Refresh Token Rotation:**

- The `refresh_token` in the response is a **NEW** token that replaces the old one
- The old refresh token is immediately invalidated and CANNOT be reused
- You MUST save this new refresh token and use it for the next authentication request
- Failure to update the refresh token will cause subsequent authentication attempts to fail
- This is a security feature called "refresh token rotation" that prevents token replay attacks

---

### Document Operations

#### Get Documents

Retrieves a paginated list of user's Granola documents.

**Endpoint:** `POST https://api.granola.ai/v2/get-documents`

**Headers:**

```
Authorization: Bearer {access_token}
Content-Type: application/json
User-Agent: Granola/5.354.0
X-Client-Version: 5.354.0
```

**Request Body:**

```json
{
  "limit": 100, // Number of documents to retrieve
  "offset": 0, // Pagination offset
  "include_last_viewed_panel": true // Include document content
}
```

**Response:**

```json
{
  "docs": [
    {
      "id": "string", // Document unique identifier
      "title": "string", // Document title
      "created_at": "ISO8601", // Creation timestamp
      "updated_at": "ISO8601", // Last update timestamp
      "last_viewed_panel": {
        "content": {
          "type": "doc", // ProseMirror document type
          "content": [] // ProseMirror content nodes
        }
      }
    }
  ]
}
```

**Limitations:**

- **Does NOT return shared documents** - only returns documents owned by the user
- For fetching documents from folders (which may contain shared documents), use `get-documents-batch` instead

---

#### Get Document Transcript

Retrieves the transcript (audio recording utterances) for a specific document.

**Endpoint:** `POST https://api.granola.ai/v1/get-document-transcript`

**Headers:**

```
Authorization: Bearer {access_token}
Content-Type: application/json
User-Agent: Granola/5.354.0
X-Client-Version: 5.354.0
```

**Request Body:**

```json
{
  "document_id": "string" // Document ID to fetch transcript for
}
```

**Response:**

```json
[
  {
    "source": "microphone|system", // Audio source type
    "text": "string", // Transcribed text
    "start_timestamp": "ISO8601", // Utterance start time
    "end_timestamp": "ISO8601", // Utterance end time
    "confidence": 0.95 // Transcription confidence
  }
]
```

**Notes:**

- Returns `404` if document has no associated transcript
- Transcripts are generated from meeting recordings

---

#### Get Workspaces

Retrieves all workspaces (organizations) accessible to the user.

**Endpoint:** `POST https://api.granola.ai/v1/get-workspaces`

**Headers:**

```
Authorization: Bearer {access_token}
Content-Type: application/json
User-Agent: Granola/5.354.0
X-Client-Version: 5.354.0
```

**Request Body:**

```json
{}
```

**Response:**

```json
[
  {
    "id": "string",              // Workspace unique identifier
    "name": "string",            // Workspace name (organization name)
    "created_at": "ISO8601",     // Creation timestamp
    "owner_id": "string"         // Owner user ID
  }
]
```

**Notes:**

- Workspaces are organizations/teams
- Each document belongs to a workspace via the `workspace_id` field

---

#### Get Document Lists

Retrieves all document lists (folders) accessible to the user.

**Endpoints:**
- `POST https://api.granola.ai/v2/get-document-lists` (preferred)
- `POST https://api.granola.ai/v1/get-document-lists` (fallback)

**Headers:**

```
Authorization: Bearer {access_token}
Content-Type: application/json
User-Agent: Granola/5.354.0
X-Client-Version: 5.354.0
```

**Request Body:**

```json
{}
```

**Response:**

```json
[
  {
    "id": "string",                    // List unique identifier
    "name": "string",                  // List/folder name (v1)
    "title": "string",                 // List/folder name (v2)
    "created_at": "ISO8601",           // Creation timestamp
    "workspace_id": "string",          // Workspace this list belongs to
    "owner_id": "string",              // Owner user ID
    "documents": [                     // Document objects in this list (v2)
      {"id": "doc_id1", ...}
    ],
    "document_ids": ["doc_id1", "..."], // Document IDs in this list (v1)
    "is_favourite": false              // Whether user favourited this list
  }
]
```

**Notes:**

- Document lists are the folder system in Granola
- A document can belong to multiple lists
- Lists are workspace-specific
- Try v2 endpoint first, fallback to v1 if not available
- Response format differs slightly between v1 and v2

---

#### Get Documents Batch

Fetch multiple documents by their IDs. **This is the most reliable way to fetch documents from folders, especially shared documents.**

**Endpoint:** `POST https://api.granola.ai/v1/get-documents-batch`

**Headers:**

```
Authorization: Bearer {access_token}
Content-Type: application/json
User-Agent: Granola/5.354.0
X-Client-Version: 5.354.0
```

**Request Body:**

```json
{
  "document_ids": ["doc_id1", "doc_id2", "..."], // Array of document IDs to fetch
  "include_last_viewed_panel": true              // Include document content
}
```

**Response:**

```json
{
  "documents": [  // or "docs" depending on API version
    {
      "id": "string",              // Document unique identifier
      "title": "string",           // Document title
      "created_at": "ISO8601",     // Creation timestamp
      "updated_at": "ISO8601",     // Last update timestamp
      "workspace_id": "string",    // Workspace ID
      "last_viewed_panel": {
        "content": {
          "type": "doc",           // ProseMirror document type
          "content": []            // ProseMirror content nodes
        }
      }
    }
  ]
}
```

**Notes:**

- **IMPORTANT**: The `get-documents` endpoint does NOT return shared documents. Use this batch endpoint to fetch shared documents.
- Recommended workflow for folders:
  1. Use `get-document-lists` to get folder contents (returns document IDs)
  2. Use `get-documents-batch` to fetch the actual documents (including shared ones)
- Batch size limit is typically 100 documents per request
- This endpoint works with both owned and shared documents
- Response may use either "documents" or "docs" field name

---

## Data Structure

### Document Format

Documents are converted from ProseMirror to Markdown with frontmatter metadata:

```markdown
---
granola_id: doc_123456
title: "My Meeting Notes"
created_at: 2025-01-15T10:30:00Z
updated_at: 2025-01-15T11:45:00Z
---

# Meeting Notes

[ProseMirror content converted to Markdown]
```

### Metadata Format

Each document is saved with a `metadata.json` file containing:

```json
{
  "document_id": "string",
  "title": "string",
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "workspace_id": "string",              // Workspace/organization ID
  "workspace_name": "string",            // Workspace/organization name
  "folders": [                           // Document lists (folders) this document belongs to
    {
      "id": "list_id",
      "name": "Folder Name"
    }
  ],
  "meeting_date": "ISO8601",             // First transcript timestamp
  "sources": ["microphone", "system"]    // Audio sources in transcript
}
```

---

## Usage

### Fetch Documents and Workspaces

The main script automatically fetches workspace information along with documents:

```bash
bun run src/main.ts /path/to/output/directory
```

Or using the npm script shorthand:

```bash
bun run main /path/to/output/directory
```

This will:
1. Automatically extract tokens from Granola (if config.json doesn't exist)
2. Fetch all workspaces and save to `workspaces.json`
3. Fetch all document lists (folders) and save to `document_lists.json`
4. Fetch all documents with workspace and folder information
5. Save each document with metadata including `workspace_id`, `workspace_name`, and `folders`

### List All Workspaces

View all available workspaces:

```bash
bun run src/list-workspaces.ts
# or
bun run list-workspaces
```

Output:
```
Workspaces found:
--------------------------------------------------------------------------------

1. My Personal Workspace
   ID: 924ba459-d11d-4da8-88c8-789979794744
   Created: 2024-01-15T10:00:00Z

2. Team Workspace
   ID: abc12345-6789-0def-ghij-klmnopqrstuv
   Created: 2024-03-20T14:30:00Z
```

### List All Folders

View all document lists (folders):

```bash
bun run src/list-folders.ts
# or
bun run list-folders
```

Output:
```
Document Lists (Folders) found:
--------------------------------------------------------------------------------

1. Sales calls
   ID: 9f3d3537-e001-401e-8ce6-b7af6f24a450
   Documents: 22
   Workspace ID: 924ba459-d11d-4da8-88c8-789979794744
   Created: 2025-10-17T11:28:08.183Z
   Description: Talking to potential clients about our solution...

2. Operations
   ID: 1fb1b706-e845-4910-ba71-832592c84adf
   Documents: 15
   Workspace ID: 924ba459-d11d-4da8-88c8-789979794744
   Created: 2025-11-03T09:46:33.558Z
```

### Filter Documents by Workspace

**List all workspaces with document counts:**

```bash
bun run src/filter-by-workspace.ts /path/to/output --list-workspaces
# or
bun run filter-by-workspace /path/to/output --list-workspaces
```

**Filter by workspace ID:**

```bash
bun run src/filter-by-workspace.ts /path/to/output --workspace-id 924ba459-d11d-4da8-88c8-789979794744
```

**Filter by workspace name:**

```bash
bun run src/filter-by-workspace.ts /path/to/output --workspace-name "Personal"
```

**View all documents grouped by workspace:**

```bash
bun run src/filter-by-workspace.ts /path/to/output
```

### Filter Documents by Folder

**List all folders with document counts:**

```bash
bun run src/filter-by-folder.ts /path/to/output --list-folders
# or
bun run filter-by-folder /path/to/output --list-folders
```

**Filter by folder ID:**

```bash
bun run src/filter-by-folder.ts /path/to/output --folder-id 9f3d3537-e001-401e-8ce6-b7af6f24a450
```

**Filter by folder name:**

```bash
bun run src/filter-by-folder.ts /path/to/output --folder-name "Sales"
```

**Show documents not in any folder:**

```bash
bun run src/filter-by-folder.ts /path/to/output --no-folder
```

**View all documents grouped by folder:**

```bash
bun run src/filter-by-folder.ts /path/to/output
```

---

## Output Structure

After running `main.py`, documents are organized as follows:

```
output_directory/
├── workspaces.json                    # All workspace (organization) information
├── document_lists.json                # All document lists (folders) information
├── granola_api_response.json          # Raw API response
├── {document_id_1}/
│   ├── document.json                  # Full document data
│   ├── metadata.json                  # Document metadata (includes workspace and folder info)
│   ├── resume.md                      # Converted summary/notes
│   ├── transcript.json                # Raw transcript data
│   └── transcript.md                  # Formatted transcript
└── {document_id_2}/
    └── ...
```

## Key Concepts

- **Workspaces**: Organizations or teams that contain documents and folders
- **Document Lists (Folders)**: Collections of documents within a workspace
- **Documents**: Individual notes/meetings with transcripts and AI-generated summaries
- A document belongs to one workspace but can be in multiple folders
- Documents can exist without being in any folder

---

## MCP Server Setup

The Granola MCP server enables **Claude Code** and **Claude Desktop** to search your meeting notes using natural language queries.

### What is MCP?

The [Model Context Protocol (MCP)](https://modelcontextprotocol.io) lets Claude access your local data through custom servers. The Granola MCP server provides Claude with search capabilities over your synced meeting documents.

### Prerequisites

1. **Sync your documents first:**
   ```bash
   bun run main /path/to/output
   ```
   This creates the indexed document structure that the MCP server reads.

2. **Install MCP dependencies** (already included if you cloned recently):
   ```bash
   bun install
   ```

### Configuration

The MCP server reads from a pre-synced directory and optionally enriches documents with attendee data from Granola's local cache.

**Environment Variables:**
- `GRANOLA_SYNC_DIR` (required) - Path to your synced documents directory (from `bun run main`)
- `GRANOLA_CACHE_PATH` (optional) - Override Granola cache location (default: `~/Library/Application Support/Granola/cache-v3.json`)

### For Claude Code

Add to your Claude Code MCP configuration file (location varies by OS):

```json
{
  "mcpServers": {
    "granola": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/reverse-engineering-granola-api/src/mcp-server.ts"],
      "env": {
        "GRANOLA_SYNC_DIR": "/absolute/path/to/output"
      }
    }
  }
}
```

**Note:** Use absolute paths, not relative paths like `~` or `./`

### For Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "granola": {
      "command": "bun",
      "args": ["run", "/Users/yourname/code/reverse-engineering-granola-api/src/mcp-server.ts"],
      "env": {
        "GRANOLA_SYNC_DIR": "/Users/yourname/output"
      }
    }
  }
}
```

After adding the configuration, restart Claude Desktop.

### Available MCP Tools

Once configured, you can ask Claude natural language queries:

**1. search_meetings** - Search meetings with filters:
- By attendee: `"Show me my last 5 meetings with joe@example.com"`
- By date: `"Find all meetings from last week"`
- By content: `"Meetings about product launch"`
- Combined: `"Meetings with Sarah from last month about pricing"`

**2. get_meeting_details** - Get full meeting information including notes

**3. get_meeting_transcript** - Get formatted transcript

**4. refresh_cache** - Reload attendee data without restarting

### Example Queries

Once the MCP server is configured, you can ask Claude:

```
"Show me my last 5 meetings with joe@example.com"
"Find all meetings from last week about product launch"
"Get the transcript from my meeting yesterday with Sarah"
"Who did I meet with most often this month?"
"Show me meetings in the Sales folder"
```

Claude will call the appropriate MCP tools and format the results for you.

### How It Works

**Architecture:**
1. Pre-synced documents provide content, transcripts, and basic metadata
2. Granola's local cache file (`cache-v3.json`) provides attendee emails and names
3. In-memory indexes enable fast multi-dimensional queries
4. Natural language dates are parsed server-side ("last week" → date range)

**Data Privacy:**
- All data stays local on your machine
- No API calls or network requests during queries
- Works offline once documents are synced

### Troubleshooting

**"Failed to initialize cache"**
- Run `bun run main /path/to/output` first to sync documents
- Verify `GRANOLA_SYNC_DIR` points to the correct directory

**"No attendee information"**
- Check that `~/Library/Application Support/Granola/cache-v3.json` exists
- The MCP server will still work without attendees (searches titles/dates/content)

**MCP server not appearing in Claude**
- Verify you're using absolute paths in the configuration
- Check Claude Desktop/Code logs for errors
- Restart Claude after modifying configuration

### Manual Testing

Test the MCP server directly:

```bash
# Run the server (it uses stdio for MCP protocol)
bun run mcp-server

# In another terminal, you can test with MCP inspector:
npx @modelcontextprotocol/inspector bun run src/mcp-server.ts
```
