#!/usr/bin/env bun

/**
 * Filter Granola Documents by Folder (Document List)
 * 
 * This script helps you filter and list documents by folder/document list.
 */

import { readdir } from "fs/promises";
import { join } from "path";

interface Metadata {
  document_id: string;
  title: string;
  folders: Array<{ id: string; name: string }>;
  created_at?: string;
  updated_at?: string;
}

interface DocumentList {
  id: string;
  name?: string;
  title?: string;
}

async function loadDocumentLists(outputDir: string): Promise<Map<string, string>> {
  const listsPath = join(outputDir, "document_lists.json");
  const listMap = new Map<string, string>();
  
  const file = Bun.file(listsPath);
  if (!await file.exists()) {
    console.warn(`No document_lists.json found at ${listsPath}`);
    return listMap;
  }
  
  try {
    const content = await file.text();
    const listsData = JSON.parse(content);
    
    let lists: DocumentList[] = [];
    if (Array.isArray(listsData)) {
      lists = listsData;
    } else if (listsData.lists) {
      lists = listsData.lists;
    } else if (listsData.document_lists) {
      lists = listsData.document_lists;
    }
    
    for (const list of lists) {
      const listName = list.name || list.title;
      if (list.id && listName) {
        listMap.set(list.id, listName);
      }
    }
  } catch (error) {
    console.error(`Error loading document lists from ${listsPath}:`, error);
  }
  
  return listMap;
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
    console.error("Usage: bun run src/filter-by-folder.ts <output_directory> [options]");
    console.error("\nOptions:");
    console.error("  --list-folders           List all folders with document counts");
    console.error("  --folder-id <id>         Filter by folder ID");
    console.error("  --folder-name <name>     Filter by folder name (partial match)");
    console.error("  --no-folder              Show documents not in any folder");
    console.error("\nExamples:");
    console.error("  bun run src/filter-by-folder.ts ./output --list-folders");
    console.error("  bun run src/filter-by-folder.ts ./output --folder-id 9f3d3537...");
    console.error("  bun run src/filter-by-folder.ts ./output --folder-name Sales");
    console.error("  bun run src/filter-by-folder.ts ./output --no-folder");
    process.exit(1);
  }
  
  const outputDir = args[0];
  const listFolders = args.includes("--list-folders");
  const noFolder = args.includes("--no-folder");
  const folderIdIndex = args.indexOf("--folder-id");
  const folderNameIndex = args.indexOf("--folder-name");
  
  const filterFolderId = folderIdIndex >= 0 ? args[folderIdIndex + 1] : null;
  const filterFolderName = folderNameIndex >= 0 ? args[folderNameIndex + 1] : null;
  
  console.log("Loading document lists...");
  const listMap = await loadDocumentLists(outputDir);
  
  console.log("Loading documents...");
  const documents = await loadDocumentMetadata(outputDir);
  
  if (documents.length === 0) {
    console.log("No documents found in output directory.");
    return;
  }
  
  console.log(`Loaded ${documents.length} documents`);
  console.log();
  
  if (listFolders) {
    // Group documents by folder
    const folderGroups = new Map<string, Metadata[]>();
    const noFolderDocs: Metadata[] = [];
    
    for (const doc of documents) {
      if (doc.folders && doc.folders.length > 0) {
        for (const folder of doc.folders) {
          if (!folderGroups.has(folder.id)) {
            folderGroups.set(folder.id, []);
          }
          folderGroups.get(folder.id)!.push(doc);
        }
      } else {
        noFolderDocs.push(doc);
      }
    }
    
    console.log("Folders:");
    console.log("=".repeat(80));
    
    let index = 1;
    for (const [folderId, docs] of folderGroups) {
      const folderName = listMap.get(folderId) || 
        (docs[0]?.folders.find(f => f.id === folderId)?.name) || 
        "Unknown Folder";
      console.log(`\n${index}. ${folderName}`);
      console.log(`   ID: ${folderId}`);
      console.log(`   Documents: ${docs.length}`);
      index++;
    }
    
    if (noFolderDocs.length > 0) {
      console.log(`\n${index}. No Folder`);
      console.log(`   Documents: ${noFolderDocs.length}`);
    }
    
    console.log();
    console.log("=".repeat(80));
    console.log(`Total folders: ${folderGroups.size + (noFolderDocs.length > 0 ? 1 : 0)}`);
    return;
  }
  
  // Filter documents
  let filtered = documents;
  
  if (noFolder) {
    filtered = filtered.filter(doc => !doc.folders || doc.folders.length === 0);
    console.log("Filtering documents with no folder");
  } else if (filterFolderId) {
    filtered = filtered.filter(doc => 
      doc.folders && doc.folders.some(f => f.id === filterFolderId)
    );
    console.log(`Filtering by folder ID: ${filterFolderId}`);
  } else if (filterFolderName) {
    filtered = filtered.filter(doc =>
      doc.folders && doc.folders.some(f =>
        f.name.toLowerCase().includes(filterFolderName.toLowerCase())
      )
    );
    console.log(`Filtering by folder name: ${filterFolderName}`);
  }
  
  console.log(`\nFound ${filtered.length} matching documents:`);
  console.log("=".repeat(80));
  
  for (let i = 0; i < filtered.length; i++) {
    const doc = filtered[i];
    const folderNames = doc.folders?.map(f => f.name).join(", ") || "No Folder";
    
    console.log(`\n${i + 1}. ${doc.title}`);
    console.log(`   ID: ${doc.document_id}`);
    console.log(`   Folders: ${folderNames}`);
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
