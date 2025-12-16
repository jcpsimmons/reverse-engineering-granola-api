#!/usr/bin/env bun

/**
 * MCP Server for Granola API
 * Enables natural language queries against Granola meeting documents
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DocumentCache } from "./document-cache.js";
import { searchDocuments, type SearchParams } from "./document-search.js";

const SYNC_DIR = process.env.GRANOLA_SYNC_DIR || "./output";
const CACHE_PATH = process.env.GRANOLA_CACHE_PATH;

async function main() {
  // Initialize document cache
  console.error("Initializing Granola MCP server...");
  const cache = new DocumentCache(SYNC_DIR, CACHE_PATH);

  try {
    await cache.initialize();
    const stats = cache.stats;
    console.error(`Cache loaded: ${stats.totalDocuments} documents, ${stats.documentsWithAttendees} with attendees, ${stats.uniqueAttendees} unique attendees`);
  } catch (error) {
    console.error(`Failed to initialize cache: ${error}`);
    console.error(`Make sure to run 'bun run main ${SYNC_DIR}' first to sync documents.`);
    process.exit(1);
  }

  // Create MCP server
  const server = new Server(
    {
      name: "granola-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "search_meetings",
          description: "Search Granola meetings with natural language queries. Supports filtering by attendees (email), date ranges (with relative dates like 'last week'), workspaces, folders, and content search in titles and transcripts.",
          inputSchema: {
            type: "object",
            properties: {
              attendee_email: {
                type: "string",
                description: "Filter by attendee email (partial match supported, e.g., 'joe' matches 'joe@example.com')",
              },
              start_date: {
                type: "string",
                description: "Start date - supports ISO8601 (e.g., '2025-01-15') or relative dates (e.g., 'last week', 'yesterday', 'last 7 days')",
              },
              end_date: {
                type: "string",
                description: "End date - supports ISO8601 or relative dates",
              },
              workspace_id: {
                type: "string",
                description: "Filter by workspace/organization ID",
              },
              folder_name: {
                type: "string",
                description: "Filter by folder name (partial match supported)",
              },
              content_query: {
                type: "string",
                description: "Search in meeting titles and transcripts for specific content",
              },
              limit: {
                type: "number",
                description: "Maximum number of results to return (default: 10)",
              },
              include_transcript: {
                type: "boolean",
                description: "Include full transcript in results (default: false, as transcripts can be large)",
              },
            },
          },
        },
        {
          name: "get_meeting_details",
          description: "Get full details for a specific meeting by document ID, including notes and metadata",
          inputSchema: {
            type: "object",
            properties: {
              document_id: {
                type: "string",
                description: "The document ID of the meeting",
              },
            },
            required: ["document_id"],
          },
        },
        {
          name: "get_meeting_transcript",
          description: "Get the formatted transcript for a specific meeting",
          inputSchema: {
            type: "object",
            properties: {
              document_id: {
                type: "string",
                description: "The document ID of the meeting",
              },
            },
            required: ["document_id"],
          },
        },
        {
          name: "refresh_cache",
          description: "Reload Granola cache file to pick up new meeting attendees and metadata without restarting the server",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "search_meetings": {
          const params = args as SearchParams;
          const results = await searchDocuments(cache, params);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(results, null, 2),
              },
            ],
          };
        }

        case "get_meeting_details": {
          const { document_id } = args as { document_id: string };

          const doc = cache.getDocument(document_id);
          const metadata = cache.getMetadata(document_id);

          if (!doc || !metadata) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: `Meeting not found: ${document_id}`,
                  }),
                },
              ],
              isError: true,
            };
          }

          const resume = await cache.getResumeMarkdown(document_id);

          const details = {
            document_id: doc.id,
            title: metadata.title,
            created_at: metadata.created_at,
            updated_at: metadata.updated_at,
            meeting_date: metadata.meeting_date,
            workspace_id: metadata.workspace_id,
            workspace_name: metadata.workspace_name,
            folders: metadata.folders,
            attendees: doc.meeting_metadata.attendees,
            conference: doc.meeting_metadata.conference,
            sources: metadata.sources,
            notes: resume || "(No notes available)",
          };

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(details, null, 2),
              },
            ],
          };
        }

        case "get_meeting_transcript": {
          const { document_id } = args as { document_id: string };

          const transcript = await cache.getTranscriptMarkdown(document_id);

          if (!transcript) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: `Transcript not found for meeting: ${document_id}`,
                    message: "This meeting may not have a transcript available",
                  }),
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text",
                text: transcript,
              },
            ],
          };
        }

        case "refresh_cache": {
          await cache.refreshCache();

          const stats = cache.stats;

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  success: true,
                  message: "Cache refreshed successfully",
                  stats: {
                    totalDocuments: stats.totalDocuments,
                    documentsWithAttendees: stats.documentsWithAttendees,
                    uniqueAttendees: stats.uniqueAttendees,
                  },
                }),
              },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ error: `Unknown tool: ${name}` }),
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      console.error(`Error executing tool ${name}:`, error);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: String(error),
              tool: name,
            }),
          },
        ],
        isError: true,
      };
    }
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Granola MCP server running on stdio");
  console.error(`Serving ${cache.stats.totalDocuments} documents from ${SYNC_DIR}`);
}

// Run server
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
