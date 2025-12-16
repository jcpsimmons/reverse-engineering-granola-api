#!/usr/bin/env bun

/**
 * Filter Granola Documents by Workspace
 * 
 * This script helps you filter and list documents by workspace.
 */

import { readdir } from "fs/promises";
import { join } from "path";

interface Metadata {
  document_id: string;
  title: string;
  workspace_id?: string;
  workspace_name?: string;
  created_at?: string;
  updated_at?: string;
}

interface Workspace {
  id: string;
  name: string;
}

async function loadWorkspaces(outputDir: string): Promise<Map<string, string>> {
  const workspacesPath = join(outputDir, "workspaces.json");
  const workspaceMap = new Map<string, string>();
  
  const file = Bun.file(workspacesPath);
  if (!await file.exists()) {
    console.warn(`No workspaces.json found at ${workspacesPath}`);
    return workspaceMap;
  }
  
  try {
    const content = await file.text();
    const workspacesData = JSON.parse(content);
    
    let workspaces: Workspace[] = [];
    if (Array.isArray(workspacesData)) {
      workspaces = workspacesData;
    } else if (workspacesData.workspaces) {
      workspaces = workspacesData.workspaces;
    }
    
    for (const workspace of workspaces) {
      if (workspace.id && workspace.name) {
        workspaceMap.set(workspace.id, workspace.name);
      }
    }
  } catch (error) {
    console.error(`Error loading workspaces from ${workspacesPath}:`, error);
  }
  
  return workspaceMap;
}

async function loadDocumentMetadata(outputDir: string): Promise<Metadata[]> {
  const documents: Metadata[] = [];
  
  try {
    const entries = await readdir(outputDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const metadataPath = join(outputDir, entry.name, "metadata.json");
      const file = Bun.file(metadataPath);
      
      if (await file.exists()) {
        try {
          const content = await file.text();
          const metadata: Metadata = JSON.parse(content);
          documents.push(metadata);
        } catch (error) {
          console.warn(`Error reading metadata from ${metadataPath}`);
        }
      }
    }
  } catch (error) {
    console.error("Error loading documents:", error);
  }
  
  return documents;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error("Usage: bun run src/filter-by-workspace.ts <output_directory> [options]");
    console.error("\nOptions:");
    console.error("  --list-workspaces        List all workspaces with document counts");
    console.error("  --workspace-id <id>      Filter by workspace ID");
    console.error("  --workspace-name <name>  Filter by workspace name (partial match)");
    console.error("\nExamples:");
    console.error("  bun run src/filter-by-workspace.ts ./output --list-workspaces");
    console.error("  bun run src/filter-by-workspace.ts ./output --workspace-id 924ba459...");
    console.error("  bun run src/filter-by-workspace.ts ./output --workspace-name Personal");
    process.exit(1);
  }
  
  const outputDir = args[0];
  const listWorkspaces = args.includes("--list-workspaces");
  const workspaceIdIndex = args.indexOf("--workspace-id");
  const workspaceNameIndex = args.indexOf("--workspace-name");
  
  const filterWorkspaceId = workspaceIdIndex >= 0 ? args[workspaceIdIndex + 1] : null;
  const filterWorkspaceName = workspaceNameIndex >= 0 ? args[workspaceNameIndex + 1] : null;
  
  console.log("Loading workspaces...");
  const workspaceMap = await loadWorkspaces(outputDir);
  
  console.log("Loading documents...");
  const documents = await loadDocumentMetadata(outputDir);
  
  if (documents.length === 0) {
    console.log("No documents found in output directory.");
    return;
  }
  
  console.log(`Loaded ${documents.length} documents`);
  console.log();
  
  if (listWorkspaces) {
    // Group documents by workspace
    const workspaceGroups = new Map<string, Metadata[]>();
    const noWorkspace: Metadata[] = [];
    
    for (const doc of documents) {
      if (doc.workspace_id) {
        if (!workspaceGroups.has(doc.workspace_id)) {
          workspaceGroups.set(doc.workspace_id, []);
        }
        workspaceGroups.get(doc.workspace_id)!.push(doc);
      } else {
        noWorkspace.push(doc);
      }
    }
    
    console.log("Workspaces:");
    console.log("=".repeat(80));
    
    let index = 1;
    for (const [workspaceId, docs] of workspaceGroups) {
      const workspaceName = workspaceMap.get(workspaceId) || "Unknown Workspace";
      console.log(`\n${index}. ${workspaceName}`);
      console.log(`   ID: ${workspaceId}`);
      console.log(`   Documents: ${docs.length}`);
      index++;
    }
    
    if (noWorkspace.length > 0) {
      console.log(`\n${index}. No Workspace`);
      console.log(`   Documents: ${noWorkspace.length}`);
    }
    
    console.log();
    console.log("=".repeat(80));
    console.log(`Total workspaces: ${workspaceGroups.size + (noWorkspace.length > 0 ? 1 : 0)}`);
    return;
  }
  
  // Filter documents
  let filtered = documents;
  
  if (filterWorkspaceId) {
    filtered = filtered.filter(doc => doc.workspace_id === filterWorkspaceId);
    console.log(`Filtering by workspace ID: ${filterWorkspaceId}`);
  }
  
  if (filterWorkspaceName) {
    filtered = filtered.filter(doc => {
      const workspaceName = doc.workspace_name || 
        (doc.workspace_id ? workspaceMap.get(doc.workspace_id) : null);
      return workspaceName?.toLowerCase().includes(filterWorkspaceName.toLowerCase());
    });
    console.log(`Filtering by workspace name: ${filterWorkspaceName}`);
  }
  
  console.log(`\nFound ${filtered.length} matching documents:`);
  console.log("=".repeat(80));
  
  for (let i = 0; i < filtered.length; i++) {
    const doc = filtered[i];
    const workspaceName = doc.workspace_name || 
      (doc.workspace_id ? workspaceMap.get(doc.workspace_id) : null) || 
      "No Workspace";
    
    console.log(`\n${i + 1}. ${doc.title}`);
    console.log(`   ID: ${doc.document_id}`);
    console.log(`   Workspace: ${workspaceName}`);
    if (doc.created_at) {
      console.log(`   Created: ${doc.created_at}`);
    }
    if (doc.updated_at) {
      console.log(`   Updated: ${doc.updated_at}`);
    }
  }
  
  console.log();
  console.log("=".repeat(80));
  console.log(`Total documents: ${filtered.length}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
