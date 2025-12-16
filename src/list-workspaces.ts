#!/usr/bin/env bun

/**
 * List Granola Workspaces
 * 
 * This script fetches and displays all workspaces from your Granola account.
 */

import { TokenManager } from "./token-manager";
import { getTokensAutomatically } from "./granola-automation";
import { fetchWorkspaces, type Workspace } from "./api-client";

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
  console.log("Granola Workspaces");
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
  
  console.log("Fetching workspaces...");
  const workspacesResponse = await fetchWorkspaces(accessToken);
  
  if (!workspacesResponse) {
    console.error("Failed to fetch workspaces");
    process.exit(1);
  }
  
  // Save to file
  const outputFile = "workspaces.json";
  await Bun.write(outputFile, JSON.stringify(workspacesResponse, null, 2));
  console.log(`Workspaces data saved to ${outputFile}`);
  console.log();
  
  // Display workspaces
  console.log("Workspaces found:");
  console.log("-".repeat(80));
  
  // workspacesResponse is already an array of workspaces
  if (workspacesResponse.length === 0) {
    console.log("No workspaces found.");
    return;
  }
  
  for (let i = 0; i < workspacesResponse.length; i++) {
    const workspace = workspacesResponse[i];
    const workspaceId = workspace.id || "N/A";
    const workspaceName = workspace.name || "Unnamed Workspace";
    const createdAt = workspace.created_at || "N/A";
    
    console.log(`\n${i + 1}. ${workspaceName}`);
    console.log(`   ID: ${workspaceId}`);
    console.log(`   Created: ${createdAt}`);
    
    if ((workspace as any).description) {
      console.log(`   Description: ${(workspace as any).description}`);
    }
    if (workspace.owner_id) {
      console.log(`   Owner ID: ${workspace.owner_id}`);
    }
    if ((workspace as any).members_count) {
      console.log(`   Members: ${(workspace as any).members_count}`);
    }
  }
  
  console.log();
  console.log("=".repeat(80));
  console.log(`Total workspaces: ${workspacesResponse.length}`);
  console.log(`Full data saved to: ${outputFile}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
