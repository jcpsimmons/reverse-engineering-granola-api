/**
 * API client utilities for Granola API
 */

const API_BASE_URL = "https://api.granola.ai";
const USER_AGENT = "Granola/5.354.0";
const CLIENT_VERSION = "5.354.0";

interface Document {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  workspace_id?: string;
  last_viewed_panel?: {
    content?: any;
  };
}

interface Workspace {
  id: string;
  name: string;
  created_at: string;
  owner_id?: string;
  description?: string;
  members_count?: number;
}

interface DocumentReference {
  id?: string;
  document_id?: string;
}

interface DocumentList {
  id: string;
  name?: string;
  title?: string;
  created_at: string;
  workspace_id?: string;
  owner_id?: string;
  documents?: DocumentReference[];
  document_ids?: (string | DocumentReference)[];
  description?: string;
  is_favourite?: boolean;
}

interface Utterance {
  source: string;
  text: string;
  start_timestamp: string;
  end_timestamp: string;
  confidence?: number;
}

interface WorkspacesResponse {
  workspaces?: Workspace[];
}

interface DocumentListsResponse {
  lists?: DocumentList[];
  document_lists?: DocumentList[];
}

/**
 * Create headers for API requests
 */
function createHeaders(token: string): HeadersInit {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "*/*",
    "User-Agent": USER_AGENT,
    "X-Client-Version": CLIENT_VERSION
  };
}

/**
 * Fetch all documents from Granola API with pagination
 */
export async function fetchGranolaDocuments(token: string, limit: number = 100): Promise<Document[]> {
  const url = `${API_BASE_URL}/v2/get-documents`;
  const headers = createHeaders(token);
  
  const allDocuments: Document[] = [];
  let offset = 0;

  while (true) {
    const data = {
      limit,
      offset,
      include_last_viewed_panel: true
    };

    try {
      console.log(`Fetching documents: offset=${offset}, limit=${limit}`);
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const result = await response.json();
      const docs = result.docs || [];

      if (docs.length === 0) {
        break;
      }

      allDocuments.push(...docs);
      console.log(`Fetched ${docs.length} documents (total so far: ${allDocuments.length})`);

      if (docs.length < limit) {
        break;
      }

      offset += limit;
    } catch (error) {
      console.error(`Error fetching documents at offset ${offset}:`, error);
      if (offset === 0) {
        return [];
      } else {
        break;
      }
    }
  }

  console.log(`Total documents fetched: ${allDocuments.length}`);
  return allDocuments;
}

/**
 * Fetch workspaces from Granola API
 */
export async function fetchWorkspaces(token: string): Promise<Workspace[] | null> {
  const url = `${API_BASE_URL}/v1/get-workspaces`;
  const headers = createHeaders(token);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({})
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result: Workspace[] | WorkspacesResponse = await response.json();
    
    // Handle different response formats
    if (Array.isArray(result)) {
      return result;
    } else if (result.workspaces) {
      return result.workspaces;
    }
    
    return [result as Workspace];
  } catch (error) {
    console.error("Error fetching workspaces:", error);
    return null;
  }
}

/**
 * Fetch document lists (folders) from Granola API
 */
export async function fetchDocumentLists(token: string): Promise<DocumentList[] | null> {
  const headers = createHeaders(token);

  // Try v2 endpoint first, then v1
  const endpoints = [
    `${API_BASE_URL}/v2/get-document-lists`,
    `${API_BASE_URL}/v1/get-document-lists`
  ];

  for (const url of endpoints) {
    try {
      console.log(`Trying endpoint: ${url}`);
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({})
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`Endpoint ${url} not found, trying next...`);
          continue;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      console.log(`Successfully fetched document lists from ${url}`);
      const result: DocumentList[] | DocumentListsResponse = await response.json();
      
      // Handle different response formats
      if (Array.isArray(result)) {
        return result;
      } else if (result.lists) {
        return result.lists;
      } else if (result.document_lists) {
        return result.document_lists;
      }
      
      return [result as DocumentList];
    } catch (error) {
      console.error(`Error fetching document lists from ${url}:`, error);
      continue;
    }
  }

  console.warn("All document list endpoints failed");
  return null;
}

/**
 * Fetch multiple documents by their IDs using the batch endpoint
 */
export async function fetchDocumentsBatch(
  token: string, 
  documentIds: string[], 
  batchSize: number = 100
): Promise<Document[]> {
  const url = `${API_BASE_URL}/v1/get-documents-batch`;
  const headers = createHeaders(token);
  
  const allDocuments: Document[] = [];

  for (let i = 0; i < documentIds.length; i += batchSize) {
    const batch = documentIds.slice(i, i + batchSize);
    const data = {
      document_ids: batch,
      include_last_viewed_panel: true
    };

    try {
      console.log(`Fetching batch ${Math.floor(i / batchSize) + 1}: ${batch.length} documents`);
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      const docs = result.documents || result.docs || [];
      allDocuments.push(...docs);
      console.log(`Fetched ${docs.length} documents in batch ${Math.floor(i / batchSize) + 1}`);
    } catch (error) {
      console.error(`Error fetching batch at index ${i}:`, error);
      continue;
    }
  }

  console.log(`Total documents fetched via batch: ${allDocuments.length}/${documentIds.length}`);
  return allDocuments;
}

/**
 * Fetch transcript for a specific document
 */
export async function fetchDocumentTranscript(token: string, documentId: string): Promise<Utterance[] | null> {
  const url = `${API_BASE_URL}/v1/get-document-transcript`;
  const headers = createHeaders(token);
  const data = { document_id: documentId };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`No transcript found for document ${documentId}`);
        return null;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching transcript for ${documentId}:`, error);
    return null;
  }
}

export type { Document, Workspace, DocumentList, Utterance };
