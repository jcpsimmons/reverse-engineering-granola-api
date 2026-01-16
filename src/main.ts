#!/usr/bin/env bun

/**
 * Main script to fetch Granola notes and save them as Markdown files
 */

import { mkdir } from "fs/promises";
import { join } from "path";
import { TokenManager, type RefreshResult } from "./token-manager";
import { getTokensAutomatically } from "./granola-automation";
import { parseDateRange, isDateInRange } from "./date-parser";
import {
  fetchGranolaDocuments,
  fetchWorkspaces,
  fetchDocumentLists,
  fetchDocumentTranscript,
  type Document,
  type Workspace,
  type DocumentList,
  type Utterance
} from "./api-client";
import { convertProseMirrorToMarkdown, convertTranscriptToMarkdown } from "./converters";

interface Metadata {
  document_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  workspace_id?: string;
  workspace_name?: string;
  folders: Array<{ id: string; name: string }>;
  meeting_date?: string;
  sources: string[];
}

async function checkConfigExists(): Promise<boolean> {
  const configPath = "config.json";
  const file = Bun.file(configPath);
  
  if (!await file.exists()) {
    console.error("Config file 'config.json' not found!");
    console.error("Attempting to automatically extract tokens from Granola...");
    return false;
  }
  return true;
}

async function ensureConfigWithTokens(): Promise<boolean> {
  const configExists = await checkConfigExists();
  
  if (!configExists) {
    try {
      // Automatically get tokens from Granola
      const tokens = await getTokensAutomatically();
      
      // Create config.json with the tokens
      const config = {
        refresh_token: tokens.refreshToken,
        client_id: tokens.clientId
      };
      
      await Bun.write("config.json", JSON.stringify(config, null, 2));
      console.log("Config file created successfully with extracted tokens");
      return true;
    } catch (error) {
      console.error("Failed to automatically extract tokens:", error);
      console.error("\nPlease create config.json manually:");
      console.error("  1. Copy config.json.template to config.json");
      console.error("  2. Add your refresh_token and client_id");
      console.error("  3. See GETTING_REFRESH_TOKEN.md for instructions");
      return false;
    }
  }
  
  return true;
}

async function main() {
  console.log("Starting Granola sync process");
  
  // Parse command line arguments
  const args = process.argv.slice(2);

  // Parse flags
  let outputDir: string | undefined;
  let sinceArg: string | undefined;
  let untilArg: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--since" && args[i + 1]) {
      sinceArg = args[++i];
    } else if (args[i] === "--until" && args[i + 1]) {
      untilArg = args[++i];
    } else if (!args[i].startsWith("--")) {
      outputDir = args[i];
    }
  }

  if (!outputDir) {
    console.error("Usage: bun run src/main.ts <output_directory> [--since <date>] [--until <date>]");
    console.error("");
    console.error("Date formats:");
    console.error("  ISO8601:   2025-01-15");
    console.error("  Relative:  today, yesterday, last week, last month");
    console.error("  Patterns:  last 7 days, last 2 weeks, last 3 months");
    console.error("");
    console.error("Examples:");
    console.error("  bun run src/main.ts ./output --since 'last week'");
    console.error("  bun run src/main.ts ./output --since 'last 2 weeks'");
    console.error("  bun run src/main.ts ./output --since 2025-01-01 --until 2025-01-31");
    process.exit(1);
  }

  console.log(`Output directory set to: ${outputDir}`);

  // Parse date range
  const { start: sinceDate, end: untilDate } = parseDateRange(sinceArg, untilArg);
  if (sinceDate) {
    console.log(`Filtering documents updated since: ${sinceDate.toISOString()}`);
  }
  if (untilDate) {
    console.log(`Filtering documents updated until: ${untilDate.toISOString()}`);
  }
  
  // Check if output directory exists
  try {
    await mkdir(outputDir, { recursive: true });
  } catch (error) {
    console.error(`Failed to create output directory '${outputDir}':`, error);
    process.exit(1);
  }
  
  console.log("Checking for config.json...");
  if (!await ensureConfigWithTokens()) {
    process.exit(1);
  }
  
  console.log("Initializing token manager...");
  const tokenManager = new TokenManager();
  
  if (!await tokenManager.loadConfig()) {
    console.error("Failed to load configuration. Exiting.");
    process.exit(1);
  }
  
  console.log("Obtaining access token...");
  let tokenResult = await tokenManager.getValidToken();

  // If invalid_grant, the refresh token is expired - re-extract from Granola
  if (typeof tokenResult === "object" && !tokenResult.success && tokenResult.reason === "invalid_grant") {
    console.log("Refresh token expired. Re-extracting tokens from Granola...");
    try {
      const tokens = await getTokensAutomatically();

      // Update config.json with fresh tokens
      const config = {
        refresh_token: tokens.refreshToken,
        client_id: tokens.clientId
      };
      await Bun.write("config.json", JSON.stringify(config, null, 2));
      console.log("Config file updated with fresh tokens");

      // Reload config and try again
      await tokenManager.loadConfig();
      tokenResult = await tokenManager.getValidToken();
    } catch (error) {
      console.error("Failed to automatically re-extract tokens:", error);
      process.exit(1);
    }
  }

  // Check if we have a valid token now
  if (typeof tokenResult === "object" && !tokenResult.success) {
    console.error("Failed to obtain access token. Exiting.");
    process.exit(1);
  }

  const accessToken = tokenResult as string;
  
  // Fetch workspaces
  console.log("Fetching workspaces from Granola API...");
  const workspacesResponse = await fetchWorkspaces(accessToken);
  
  const workspaceMap: Map<string, string> = new Map();
  if (workspacesResponse) {
    console.log("Successfully fetched workspaces");
    
    // Save workspaces response
    const workspacesPath = join(outputDir, "workspaces.json");
    await Bun.write(workspacesPath, JSON.stringify(workspacesResponse, null, 2));
    console.log(`Workspaces data saved to ${workspacesPath}`);
    
    // Build workspace map - workspacesResponse is already an array
    for (const workspace of workspacesResponse) {
      if (workspace.id && workspace.name) {
        workspaceMap.set(workspace.id, workspace.name);
      }
    }
  } else {
    console.warn("Could not fetch workspaces - workspace names will not be included in metadata");
  }
  
  // Fetch document lists (folders)
  console.log("Fetching document lists (folders) from Granola API...");
  const documentListsResponse = await fetchDocumentLists(accessToken);
  
  const documentToListsMap: Map<string, Array<{ id: string; name: string }>> = new Map();
  const listIdToNameMap: Map<string, string> = new Map();
  
  if (documentListsResponse) {
    console.log("Successfully fetched document lists");
    
    // Save document lists response
    const documentListsPath = join(outputDir, "document_lists.json");
    await Bun.write(documentListsPath, JSON.stringify(documentListsResponse, null, 2));
    console.log(`Document lists data saved to ${documentListsPath}`);
    
    // Build document-to-lists mapping - documentListsResponse is already an array
    for (const docList of documentListsResponse) {
      const listId = docList.id;
      const listName = docList.name || docList.title;
      
      if (listId && listName) {
        listIdToNameMap.set(listId, listName);
      }
      
      // Get documents in this list
      const documentsInList = docList.documents || docList.document_ids || [];
      
      for (const doc of documentsInList) {
        const docId = typeof doc === 'object' ? (doc.id || doc.document_id) : doc;
        
        if (docId) {
          if (!documentToListsMap.has(docId)) {
            documentToListsMap.set(docId, []);
          }
          documentToListsMap.get(docId)!.push({
            id: listId,
            name: listName
          });
        }
      }
    }
    
    console.log(`Found ${documentListsResponse.length} document lists with ${documentToListsMap.size} documents organized`);
  } else {
    console.warn("Could not fetch document lists - folder information will not be included in metadata");
  }
  
  // Fetch documents
  console.log("Fetching documents from Granola API...");
  let documents = await fetchGranolaDocuments(accessToken);

  // Save API response
  const apiResponsePath = join(outputDir, "granola_api_response.json");
  await Bun.write(apiResponsePath, JSON.stringify({ docs: documents }, null, 2));
  console.log(`API response saved to ${apiResponsePath}`);

  if (!documents || documents.length === 0) {
    console.warn("No documents found in the API response");
    return;
  }

  console.log(`Successfully fetched ${documents.length} documents from Granola`);

  // Filter by date range if specified
  if (sinceDate || untilDate) {
    const beforeCount = documents.length;
    documents = documents.filter(doc =>
      isDateInRange(doc.updated_at, sinceDate, untilDate)
    );
    console.log(`Filtered to ${documents.length} documents (excluded ${beforeCount - documents.length} outside date range)`);

    if (documents.length === 0) {
      console.warn("No documents match the specified date range");
      return;
    }
  }
  
  let syncedCount = 0;
  for (const doc of documents) {
    const title = doc.title || "Untitled Granola Note";
    const docId = doc.id || "unknown_id";
    console.log(`Processing document: ${title} (ID: ${docId})`);
    
    const docFolder = join(outputDir, docId);
    await mkdir(docFolder, { recursive: true });
    console.log(`Created folder: ${docFolder}`);
    
    try {
      // Save raw document JSON
      const documentJsonPath = join(docFolder, "document.json");
      await Bun.write(documentJsonPath, JSON.stringify(doc, null, 2));
      console.log(`Saved raw document JSON to: ${documentJsonPath}`);
      
      // Fetch and save transcript
      const transcriptData = await fetchDocumentTranscript(accessToken, docId);
      if (transcriptData) {
        const transcriptJsonPath = join(docFolder, "transcript.json");
        await Bun.write(transcriptJsonPath, JSON.stringify(transcriptData, null, 2));
        console.log(`Saved raw transcript JSON to: ${transcriptJsonPath}`);
      }
      
      // Build metadata
      const workspaceId = doc.workspace_id;
      const metadata: Metadata = {
        document_id: docId,
        title: title,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
        workspace_id: workspaceId,
        workspace_name: workspaceId ? workspaceMap.get(workspaceId) : undefined,
        folders: documentToListsMap.get(docId) || [],
        meeting_date: undefined,
        sources: []
      };
      
      if (transcriptData && Array.isArray(transcriptData) && transcriptData.length > 0) {
        const sources = [...new Set(transcriptData.map(u => u.source || 'unknown'))];
        metadata.sources = sources;
        
        const firstUtterance = transcriptData[0];
        if (firstUtterance.start_timestamp) {
          metadata.meeting_date = firstUtterance.start_timestamp;
        }
      }
      
      const metadataPath = join(docFolder, "metadata.json");
      await Bun.write(metadataPath, JSON.stringify(metadata, null, 2));
      console.log(`Saved metadata to: ${metadataPath}`);
      
      // Convert and save resume/content
      let contentToParse = null;
      if (doc.last_viewed_panel?.content?.type === "doc") {
        contentToParse = doc.last_viewed_panel.content;
      }
      
      if (contentToParse) {
        console.log(`Converting document to markdown: ${title}`);
        const markdownContent = convertProseMirrorToMarkdown(contentToParse);
        
        const resumePath = join(docFolder, "resume.md");
        await Bun.write(resumePath, `# ${title}\n\n${markdownContent}`);
        console.log(`Saved resume to: ${resumePath}`);
      } else {
        console.warn(`No content found for resume.md in document: ${title}`);
      }
      
      // Convert and save transcript markdown
      if (transcriptData) {
        const transcriptMarkdown = convertTranscriptToMarkdown(transcriptData);
        const transcriptMdPath = join(docFolder, "transcript.md");
        await Bun.write(transcriptMdPath, transcriptMarkdown);
        console.log(`Saved transcript markdown to: ${transcriptMdPath}`);
      } else {
        console.warn(`No transcript available for document: ${title}`);
      }
      
      console.log(`Successfully processed document: ${title}`);
      syncedCount++;
    } catch (error) {
      console.error(`Error processing document '${title}' (ID: ${docId}):`, error);
    }
  }
  
  console.log(`Sync complete. ${syncedCount} documents processed and saved to '${outputDir}'`);
}

// Run main function
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
