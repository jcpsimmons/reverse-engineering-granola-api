#!/usr/bin/env bun

/**
 * List Granola Document Lists (Folders)
 * 
 * This script fetches and displays all document lists (folders) from your Granola account.
 */

import { TokenManager } from "./token-manager";
import { getTokensAutomatically } from "./granola-automation";
import { fetchDocumentLists, type DocumentList } from "./api-client";

async function ensureConfigWithTokens(): Promise<boolean> {
  const file = Bun.file("config.json");
  
  if (!await file.exists()) {
    console.error("Config file 'config.json' not found!");
    console.error("Attempting to automatically extract tokens from Granola...");
    
    try {
      const tokens = await getTokensAutomatically();
      const config = {
        refresh_token: tokens.refreshToken,
        client_id: tokens.clientId
      };
      
      await Bun.write("config.json", JSON.stringify(config, null, 2));
      console.log("Config file created successfully with extracted tokens");
      return true;
    } catch (error) {
      console.error("Failed to automatically extract tokens:", error);
      return false;
    }
  }
  
  return true;
}

async function main() {
  console.log("=".repeat(80));
  console.log("Granola Document Lists (Folders)");
  console.log("=".repeat(80));
  console.log();
  
  if (!await ensureConfigWithTokens()) {
    console.error("Please create config.json first.");
    process.exit(1);
  }
  
  console.log("Obtaining access token...");
  const tokenManager = new TokenManager();
  await tokenManager.loadConfig();
  
  const accessToken = await tokenManager.getValidToken();
  if (!accessToken) {
    console.error("Failed to obtain access token");
    process.exit(1);
  }
  
  console.log("Access token obtained successfully");
  console.log();
  
  console.log("Fetching document lists...");
  const listsResponse = await fetchDocumentLists(accessToken);
  
  if (!listsResponse) {
    console.error("Failed to fetch document lists");
    process.exit(1);
  }
  
  // Save to file
  const outputFile = "document_lists.json";
  await Bun.write(outputFile, JSON.stringify(listsResponse, null, 2));
  console.log(`Document lists data saved to ${outputFile}`);
  console.log();
  
  // Display document lists
  console.log("Document Lists (Folders) found:");
  console.log("-".repeat(80));
  
  let lists: DocumentList[] = [];
  if (Array.isArray(listsResponse)) {
    lists = listsResponse;
  } else if ((listsResponse as any).lists) {
    lists = (listsResponse as any).lists;
  } else if ((listsResponse as any).document_lists) {
    lists = (listsResponse as any).document_lists;
  } else {
    lists = [listsResponse as DocumentList];
  }
  
  if (lists.length === 0) {
    console.log("No document lists found or unexpected response format.");
    console.log(`Response structure: ${JSON.stringify(listsResponse, null, 2)}`);
    return;
  }
  
  for (let i = 0; i < lists.length; i++) {
    const docList = lists[i];
    const listId = docList.id || "N/A";
    const listName = docList.name || docList.title || "Unnamed List";
    const createdAt = docList.created_at || "N/A";
    const workspaceId = docList.workspace_id || "N/A";
    
    // Count documents in list
    const documentsInList = docList.documents || docList.document_ids || [];
    const docCount = Array.isArray(documentsInList) ? documentsInList.length : 0;
    
    console.log(`\n${i + 1}. ${listName}`);
    console.log(`   ID: ${listId}`);
    console.log(`   Documents: ${docCount}`);
    console.log(`   Workspace ID: ${workspaceId}`);
    console.log(`   Created: ${createdAt}`);
    
    if (docList.description) {
      let desc = docList.description;
      if (desc.length > 80) {
        desc = desc.substring(0, 77) + "...";
      }
      console.log(`   Description: ${desc}`);
    }
    if (docList.owner_id) {
      console.log(`   Owner ID: ${docList.owner_id}`);
    }
    if (docList.is_favourite !== undefined) {
      console.log(`   Favourite: ${docList.is_favourite}`);
    }
    
    // Show first few documents if available
    if (docCount > 0) {
      const docIds: string[] = [];
      for (let j = 0; j < Math.min(5, documentsInList.length); j++) {
        const doc = documentsInList[j];
        if (typeof doc === 'object') {
          docIds.push((doc as any).id || (doc as any).document_id || 'unknown');
        } else {
          docIds.push(String(doc));
        }
      }
      
      if (docCount <= 5) {
        console.log(`   Document IDs: ${docIds.join(', ')}`);
      } else {
        console.log(`   First 5 Document IDs: ${docIds.join(', ')}...`);
      }
    }
  }
  
  console.log();
  console.log("=".repeat(80));
  console.log(`Total document lists: ${lists.length}`);
  console.log(`Full data saved to: ${outputFile}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
