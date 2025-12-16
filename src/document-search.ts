/**
 * Multi-dimensional search algorithm for Granola documents
 */

import type { DocumentCache } from "./document-cache";
import type { EnrichedDocument } from "./api-client";
import { parseDateRange } from "./date-parser";

export interface SearchParams {
  attendee_email?: string;
  start_date?: string;
  end_date?: string;
  workspace_id?: string;
  folder_name?: string;
  content_query?: string;
  limit?: number;
  include_transcript?: boolean;
}

export interface SearchMatch {
  document_id: string;
  title: string;
  meeting_date?: string;
  workspace_name?: string;
  folders: string[];
  attendees: Array<{
    email?: string;
    name?: string;
    organizer?: boolean;
  }>;
  snippet?: string;
  relevance_score: number;
  transcript?: string;
}

export interface SearchResponse {
  matches: SearchMatch[];
  total_matches: number;
  query_summary: string;
}

/**
 * Search documents with multi-dimensional filtering
 */
export async function searchDocuments(
  cache: DocumentCache,
  params: SearchParams
): Promise<SearchResponse> {
  const {
    attendee_email,
    start_date,
    end_date,
    workspace_id,
    folder_name,
    content_query,
    limit = 10,
    include_transcript = false
  } = params;

  // Start with all document IDs
  let candidateIds = new Set(cache.getAllDocumentIds());

  // Build query summary for user
  const filters: string[] = [];

  // Apply attendee filter
  if (attendee_email) {
    const attendeeDocs = cache.getDocumentsByAttendee(attendee_email);
    candidateIds = intersect(candidateIds, attendeeDocs);
    filters.push(`attendee: "${attendee_email}"`);
  }

  // Apply date range filter
  if (start_date || end_date) {
    const { start, end } = parseDateRange(start_date, end_date);
    const dateDocs = cache.getDocumentsByDateRange(start, end);
    candidateIds = intersect(candidateIds, dateDocs);

    if (start_date && end_date) {
      filters.push(`dates: ${start_date} to ${end_date}`);
    } else if (start_date) {
      filters.push(`from: ${start_date}`);
    } else if (end_date) {
      filters.push(`until: ${end_date}`);
    }
  }

  // Apply workspace filter
  if (workspace_id) {
    const workspaceDocs = cache.getDocumentsByWorkspace(workspace_id);
    candidateIds = intersect(candidateIds, workspaceDocs);
    filters.push(`workspace: ${workspace_id}`);
  }

  // Apply folder filter
  if (folder_name) {
    const folderDocs = cache.getDocumentsByFolder(folder_name);
    candidateIds = intersect(candidateIds, folderDocs);
    filters.push(`folder: "${folder_name}"`);
  }

  // Apply content query filter (searches titles and optionally transcripts)
  let contentMatchIds: Set<string> | null = null;
  if (content_query) {
    contentMatchIds = cache.getDocumentsByTitle(content_query);
    filters.push(`content: "${content_query}"`);

    // For content search, we'll score matches but not filter yet
    // (we'll apply it during relevance scoring)
  }

  // Build query summary
  const querySummary = filters.length > 0
    ? `Filtering by: ${filters.join(", ")}`
    : "Showing all meetings";

  // Calculate relevance scores for remaining candidates
  const scoredDocs: Array<{ docId: string; score: number }> = [];

  for (const docId of candidateIds) {
    const doc = cache.getDocument(docId);
    const metadata = cache.getMetadata(docId);

    if (!doc || !metadata) continue;

    // Calculate relevance score
    let score = await calculateRelevance(
      doc,
      metadata,
      content_query,
      contentMatchIds?.has(docId) || false,
      cache
    );

    // If content_query is specified, only include docs that match
    if (content_query && score === 0) {
      continue;
    }

    scoredDocs.push({ docId, score });
  }

  // Sort by relevance score (descending)
  scoredDocs.sort((a, b) => b.score - a.score);

  // Limit results
  const topDocs = scoredDocs.slice(0, limit);

  // Format results
  const matches: SearchMatch[] = [];
  for (const { docId, score } of topDocs) {
    const doc = cache.getDocument(docId)!;
    const metadata = cache.getMetadata(docId)!;

    const match: SearchMatch = {
      document_id: docId,
      title: metadata.title,
      meeting_date: metadata.meeting_date || metadata.created_at,
      workspace_name: metadata.workspace_name,
      folders: metadata.folders.map(f => f.name),
      attendees: doc.meeting_metadata.attendees || [],
      relevance_score: score
    };

    // Add snippet from resume.md
    const resume = await cache.getResumeMarkdown(docId);
    if (resume) {
      match.snippet = resume.substring(0, 200).trim() + (resume.length > 200 ? "..." : "");
    }

    // Include transcript if requested
    if (include_transcript) {
      const transcript = await cache.getTranscriptMarkdown(docId);
      if (transcript) {
        match.transcript = transcript;
      }
    }

    matches.push(match);
  }

  return {
    matches,
    total_matches: scoredDocs.length,
    query_summary: querySummary
  };
}

/**
 * Calculate relevance score for a document
 */
async function calculateRelevance(
  doc: EnrichedDocument,
  metadata: any,
  contentQuery: string | undefined,
  titleMatches: boolean,
  cache: DocumentCache
): Promise<number> {
  let score = 0;

  // Title match (highest weight)
  if (contentQuery && titleMatches) {
    score += 10;
  }

  // Recency boost (recent meetings rank higher)
  const meetingDate = metadata.meeting_date || metadata.created_at;
  if (meetingDate) {
    const date = new Date(meetingDate);
    if (!isNaN(date.getTime())) {
      const daysAgo = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.max(0, 5 - daysAgo / 7);
      score += recencyScore;
    }
  }

  // Organization (folders suggest importance)
  score += metadata.folders.length * 0.5;

  // Has attendees (indicates it's a real meeting)
  if (doc.meeting_metadata.attendees && doc.meeting_metadata.attendees.length > 0) {
    score += 1;
  }

  // Content search in transcript (if query provided)
  if (contentQuery) {
    const transcript = await cache.getTranscript(doc.id);
    if (transcript && transcript.length > 0) {
      const transcriptText = transcript.map(u => u.text).join(" ").toLowerCase();
      const query = contentQuery.toLowerCase();

      if (transcriptText.includes(query)) {
        score += 5; // Boost for transcript matches
      }
    }
  }

  return score;
}

/**
 * Set intersection utility
 */
function intersect<T>(setA: Set<T>, setB: Set<T>): Set<T> {
  const result = new Set<T>();
  for (const item of setA) {
    if (setB.has(item)) {
      result.add(item);
    }
  }
  return result;
}
