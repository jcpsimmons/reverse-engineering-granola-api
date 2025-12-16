/**
 * Parse Granola's local cache file to extract attendee and meeting metadata
 */

import { homedir } from "os";
import { join } from "path";

export interface CacheAttendee {
  email?: string;
  displayName?: string;
  organizer?: boolean;
  responseStatus?: string;
}

export interface CacheMeeting {
  id: string;
  attendees?: CacheAttendee[];
  conferenceData?: {
    entryPoints?: Array<{ uri?: string; entryPointType?: string }>;
  };
  calendarId?: string;
}

const DEFAULT_CACHE_PATH = join(homedir(), "Library/Application Support/Granola/cache-v3.json");

/**
 * Parse Granola's cache file to extract meeting metadata
 */
export async function parseCacheFile(cachePath: string = DEFAULT_CACHE_PATH): Promise<Map<string, CacheMeeting>> {
  const meetings = new Map<string, CacheMeeting>();

  try {
    const file = Bun.file(cachePath);

    if (!await file.exists()) {
      console.error(`Cache file not found at ${cachePath}`);
      console.error("Attendee information will not be available. MCP server will work without it.");
      return meetings;
    }

    const content = await file.text();
    let cacheData: any;

    try {
      cacheData = JSON.parse(content);
    } catch (parseError) {
      console.error(`Failed to parse cache file as JSON: ${parseError}`);
      console.error("Attendee information will not be available.");
      return meetings;
    }

    // The cache structure may vary, so we'll try to handle different formats
    // Look for meeting/event data in the cache
    if (cacheData && typeof cacheData === 'object') {
      // Try different possible structures
      const meetingData = cacheData.meetings || cacheData.events || cacheData.documents || cacheData;

      if (Array.isArray(meetingData)) {
        for (const meeting of meetingData) {
          extractMeetingInfo(meeting, meetings);
        }
      } else if (typeof meetingData === 'object') {
        // Handle object with nested meetings
        for (const key in meetingData) {
          const value = meetingData[key];
          if (value && typeof value === 'object') {
            extractMeetingInfo(value, meetings);
          }
        }
      }
    }

    console.log(`Parsed cache file: found ${meetings.size} meetings with metadata`);
  } catch (error) {
    console.error(`Error reading cache file: ${error}`);
    console.error("Attendee information will not be available. MCP server will continue without it.");
  }

  return meetings;
}

/**
 * Extract meeting information from a cache entry
 */
function extractMeetingInfo(entry: any, meetings: Map<string, CacheMeeting>): void {
  if (!entry || typeof entry !== 'object') {
    return;
  }

  // Try to find the document/meeting ID
  const id = entry.id || entry.document_id || entry.documentId || entry.meeting_id;
  if (!id) {
    return;
  }

  const meeting: CacheMeeting = { id };

  // Extract attendees
  const attendeesList = entry.attendees || entry.participants || entry.invitees;
  if (Array.isArray(attendeesList)) {
    meeting.attendees = attendeesList
      .filter(a => a && typeof a === 'object')
      .map(attendee => ({
        email: attendee.email || attendee.emailAddress,
        displayName: attendee.displayName || attendee.name || attendee.full_name,
        organizer: attendee.organizer || attendee.isOrganizer || false,
        responseStatus: attendee.responseStatus || attendee.status
      }));
  }

  // Extract conference data (Zoom, Google Meet, etc.)
  const confData = entry.conferenceData || entry.conference || entry.meetingInfo;
  if (confData && typeof confData === 'object') {
    meeting.conferenceData = {
      entryPoints: []
    };

    const entryPoints = confData.entryPoints || confData.urls || confData.links;
    if (Array.isArray(entryPoints)) {
      meeting.conferenceData.entryPoints = entryPoints.map(ep => ({
        uri: ep.uri || ep.url || ep.link,
        entryPointType: ep.entryPointType || ep.type
      }));
    }
  }

  // Extract calendar ID
  meeting.calendarId = entry.calendarId || entry.calendar_id;

  meetings.set(id, meeting);
}

/**
 * Get meeting metadata for a specific document ID
 */
export function getMeetingFromCache(
  documentId: string,
  cache: Map<string, CacheMeeting>
): CacheMeeting | null {
  return cache.get(documentId) || null;
}
