/**
 * Document cache with indexes for fast multi-dimensional searching
 */

import { join } from "path";
import { readdir } from "fs/promises";
import type { EnrichedDocument } from "./api-client";
import type { Utterance } from "./api-client";
import { parseCacheFile, getMeetingFromCache, type CacheMeeting } from "./cache-parser";

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

export class DocumentCache {
  private documentsById = new Map<string, EnrichedDocument>();
  private metadataById = new Map<string, Metadata>();

  // Indexes for fast lookups
  private attendeeIndex = new Map<string, Set<string>>();  // email (lowercase) -> doc IDs
  private dateIndex = new Map<string, Set<string>>();      // ISO date string -> doc IDs
  private workspaceIndex = new Map<string, Set<string>>();
  private folderIndex = new Map<string, Set<string>>();    // folder name (lowercase) -> doc IDs
  private tokenIndex = new Map<string, Set<string>>();     // title token (lowercase) -> doc IDs

  private granolaCache: Map<string, CacheMeeting> = new Map();

  constructor(
    private syncDir: string,
    private cachePath?: string
  ) {}

  /**
   * Initialize the cache by loading all documents and building indexes
   */
  async initialize(): Promise<void> {
    console.error("Loading Granola documents from sync directory...");

    // 1. Parse Granola cache file for attendee data
    console.error("Parsing Granola cache file...");
    this.granolaCache = await parseCacheFile(this.cachePath);

    // 2. Load all metadata.json files
    console.error("Loading document metadata...");
    await this.loadMetadata();

    // 3. Build search indexes
    console.error("Building search indexes...");
    this.buildIndexes();

    console.error(`Loaded ${this.documentsById.size} documents with ${this.granolaCache.size} enriched with cache data`);
  }

  /**
   * Load all metadata.json files from the sync directory
   */
  private async loadMetadata(): Promise<void> {
    try {
      const entries = await readdir(this.syncDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const docId = entry.name;
        const metadataPath = join(this.syncDir, docId, "metadata.json");

        try {
          const file = Bun.file(metadataPath);
          if (!await file.exists()) {
            continue;
          }

          const metadata: Metadata = await file.json();
          this.metadataById.set(docId, metadata);

          // Create enriched document
          const doc: EnrichedDocument = {
            id: docId,
            title: metadata.title,
            created_at: metadata.created_at,
            updated_at: metadata.updated_at,
            workspace_id: metadata.workspace_id,
            meeting_metadata: {
              attendees: [],
              conference: undefined,
              calendarId: undefined
            }
          };

          // Enrich with cache data if available
          const cacheMeeting = getMeetingFromCache(docId, this.granolaCache);
          if (cacheMeeting) {
            doc.meeting_metadata.attendees = cacheMeeting.attendees?.map(a => ({
              email: a.email,
              name: a.displayName,
              organizer: a.organizer,
              responseStatus: a.responseStatus
            })) || [];

            if (cacheMeeting.conferenceData && cacheMeeting.conferenceData.entryPoints && cacheMeeting.conferenceData.entryPoints.length > 0) {
              const firstEntry = cacheMeeting.conferenceData.entryPoints[0];
              doc.meeting_metadata.conference = {
                url: firstEntry.uri,
                platform: firstEntry.entryPointType
              };
            }

            doc.meeting_metadata.calendarId = cacheMeeting.calendarId;
          }

          this.documentsById.set(docId, doc);
        } catch (error) {
          console.error(`Error loading metadata for ${docId}:`, error);
        }
      }
    } catch (error) {
      console.error(`Error reading sync directory ${this.syncDir}:`, error);
      throw new Error(`Failed to load documents from ${this.syncDir}. Make sure to run 'bun run main <output>' first to sync documents.`);
    }
  }

  /**
   * Build search indexes for fast lookups
   */
  private buildIndexes(): void {
    for (const [docId, doc] of this.documentsById) {
      const metadata = this.metadataById.get(docId);
      if (!metadata) continue;

      // Index by attendee email
      if (doc.meeting_metadata.attendees) {
        for (const attendee of doc.meeting_metadata.attendees) {
          if (attendee.email) {
            const email = attendee.email.toLowerCase();
            if (!this.attendeeIndex.has(email)) {
              this.attendeeIndex.set(email, new Set());
            }
            this.attendeeIndex.get(email)!.add(docId);
          }
        }
      }

      // Index by date (use meeting_date if available, otherwise created_at)
      const dateStr = metadata.meeting_date || metadata.created_at;
      if (dateStr) {
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          const isoDate = date.toISOString().split('T')[0]; // YYYY-MM-DD
          if (!this.dateIndex.has(isoDate)) {
            this.dateIndex.set(isoDate, new Set());
          }
          this.dateIndex.get(isoDate)!.add(docId);
        }
      }

      // Index by workspace
      if (metadata.workspace_id) {
        if (!this.workspaceIndex.has(metadata.workspace_id)) {
          this.workspaceIndex.set(metadata.workspace_id, new Set());
        }
        this.workspaceIndex.get(metadata.workspace_id)!.add(docId);
      }

      // Index by folder name
      for (const folder of metadata.folders) {
        const folderName = folder.name.toLowerCase();
        if (!this.folderIndex.has(folderName)) {
          this.folderIndex.set(folderName, new Set());
        }
        this.folderIndex.get(folderName)!.add(docId);
      }

      // Index by title tokens
      const tokens = this.tokenize(metadata.title);
      for (const token of tokens) {
        if (!this.tokenIndex.has(token)) {
          this.tokenIndex.set(token, new Set());
        }
        this.tokenIndex.get(token)!.add(docId);
      }
    }
  }

  /**
   * Tokenize a string for search indexing
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^\w]+/)
      .filter(t => t.length > 0);
  }

  /**
   * Refresh cache data without reloading all documents
   */
  async refreshCache(): Promise<void> {
    console.error("Refreshing Granola cache...");
    this.granolaCache = await parseCacheFile(this.cachePath);

    // Re-enrich documents with updated cache data
    for (const [docId, doc] of this.documentsById) {
      const cacheMeeting = getMeetingFromCache(docId, this.granolaCache);
      if (cacheMeeting) {
        doc.meeting_metadata.attendees = cacheMeeting.attendees?.map(a => ({
          email: a.email,
          name: a.displayName,
          organizer: a.organizer,
          responseStatus: a.responseStatus
        })) || [];

        if (cacheMeeting.conferenceData && cacheMeeting.conferenceData.entryPoints && cacheMeeting.conferenceData.entryPoints.length > 0) {
          const firstEntry = cacheMeeting.conferenceData.entryPoints[0];
          doc.meeting_metadata.conference = {
            url: firstEntry.uri,
            platform: firstEntry.entryPointType
          };
        }

        doc.meeting_metadata.calendarId = cacheMeeting.calendarId;
      }
    }

    // Rebuild attendee index
    this.attendeeIndex.clear();
    for (const [docId, doc] of this.documentsById) {
      if (doc.meeting_metadata.attendees) {
        for (const attendee of doc.meeting_metadata.attendees) {
          if (attendee.email) {
            const email = attendee.email.toLowerCase();
            if (!this.attendeeIndex.has(email)) {
              this.attendeeIndex.set(email, new Set());
            }
            this.attendeeIndex.get(email)!.add(docId);
          }
        }
      }
    }

    console.error("Cache refresh complete");
  }

  /**
   * Get a document by ID
   */
  getDocument(docId: string): EnrichedDocument | undefined {
    return this.documentsById.get(docId);
  }

  /**
   * Get metadata for a document
   */
  getMetadata(docId: string): Metadata | undefined {
    return this.metadataById.get(docId);
  }

  /**
   * Get all document IDs
   */
  getAllDocumentIds(): string[] {
    return Array.from(this.documentsById.keys());
  }

  /**
   * Get document IDs by attendee email (partial match)
   */
  getDocumentsByAttendee(emailPattern: string): Set<string> {
    const pattern = emailPattern.toLowerCase();
    const matchingDocs = new Set<string>();

    for (const [email, docIds] of this.attendeeIndex) {
      if (email.includes(pattern)) {
        for (const docId of docIds) {
          matchingDocs.add(docId);
        }
      }
    }

    return matchingDocs;
  }

  /**
   * Get document IDs by date range
   */
  getDocumentsByDateRange(start: Date | null, end: Date | null): Set<string> {
    const matchingDocs = new Set<string>();

    for (const [docId, metadata] of this.metadataById) {
      const dateStr = metadata.meeting_date || metadata.created_at;
      if (!dateStr) continue;

      const date = new Date(dateStr);
      if (isNaN(date.getTime())) continue;

      if (start && date < start) continue;
      if (end && date > end) continue;

      matchingDocs.add(docId);
    }

    return matchingDocs;
  }

  /**
   * Get document IDs by workspace
   */
  getDocumentsByWorkspace(workspaceId: string): Set<string> {
    return this.workspaceIndex.get(workspaceId) || new Set();
  }

  /**
   * Get document IDs by folder name (partial match)
   */
  getDocumentsByFolder(folderNamePattern: string): Set<string> {
    const pattern = folderNamePattern.toLowerCase();
    const matchingDocs = new Set<string>();

    for (const [folderName, docIds] of this.folderIndex) {
      if (folderName.includes(pattern)) {
        for (const docId of docIds) {
          matchingDocs.add(docId);
        }
      }
    }

    return matchingDocs;
  }

  /**
   * Get document IDs by title tokens
   */
  getDocumentsByTitle(query: string): Set<string> {
    const tokens = this.tokenize(query);
    const matchingSets: Set<string>[] = [];

    for (const token of tokens) {
      const docIds = this.tokenIndex.get(token);
      if (docIds) {
        matchingSets.push(docIds);
      }
    }

    if (matchingSets.length === 0) {
      return new Set();
    }

    // Return union of all matching doc IDs
    const result = new Set<string>();
    for (const set of matchingSets) {
      for (const docId of set) {
        result.add(docId);
      }
    }

    return result;
  }

  /**
   * Get transcript for a document (lazy-loaded from disk)
   */
  async getTranscript(docId: string): Promise<Utterance[] | null> {
    const transcriptPath = join(this.syncDir, docId, "transcript.json");

    try {
      const file = Bun.file(transcriptPath);
      if (!await file.exists()) {
        return null;
      }

      return await file.json();
    } catch (error) {
      console.error(`Error loading transcript for ${docId}:`, error);
      return null;
    }
  }

  /**
   * Get formatted transcript markdown for a document
   */
  async getTranscriptMarkdown(docId: string): Promise<string | null> {
    const transcriptPath = join(this.syncDir, docId, "transcript.md");

    try {
      const file = Bun.file(transcriptPath);
      if (!await file.exists()) {
        return null;
      }

      return await file.text();
    } catch (error) {
      console.error(`Error loading transcript markdown for ${docId}:`, error);
      return null;
    }
  }

  /**
   * Get resume markdown for a document
   */
  async getResumeMarkdown(docId: string): Promise<string | null> {
    const resumePath = join(this.syncDir, docId, "resume.md");

    try {
      const file = Bun.file(resumePath);
      if (!await file.exists()) {
        return null;
      }

      return await file.text();
    } catch (error) {
      console.error(`Error loading resume markdown for ${docId}:`, error);
      return null;
    }
  }

  /**
   * Get cache statistics
   */
  get stats() {
    return {
      totalDocuments: this.documentsById.size,
      documentsWithAttendees: Array.from(this.documentsById.values())
        .filter(d => d.meeting_metadata.attendees && d.meeting_metadata.attendees.length > 0).length,
      uniqueAttendees: this.attendeeIndex.size,
      uniqueFolders: this.folderIndex.size,
      uniqueWorkspaces: this.workspaceIndex.size
    };
  }
}
