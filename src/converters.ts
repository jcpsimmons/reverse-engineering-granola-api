/**
 * Utilities for converting ProseMirror to Markdown and formatting transcripts
 */

import type { Utterance } from "./api-client";

interface ProseMirrorNode {
  type?: string;
  content?: ProseMirrorNode[];
  text?: string;
  attrs?: Record<string, any>;
  marks?: any[];
}

/**
 * Convert ProseMirror JSON to Markdown
 */
export function convertProseMirrorToMarkdown(content: ProseMirrorNode | null | undefined): string {
  if (!content || typeof content !== 'object' || !content.content) {
    return "";
  }
  
  function processNode(node: ProseMirrorNode): string {
    if (!node || typeof node !== 'object') {
      return "";
    }
    
    const nodeType = node.type || '';
    const content = node.content || [];
    const text = node.text || '';
    
    if (nodeType === 'heading') {
      const level = node.attrs?.level || 1;
      const headingText = content.map(processNode).join('');
      return '#'.repeat(level) + ' ' + headingText + '\n\n';
    }
    
    if (nodeType === 'paragraph') {
      const paraText = content.map(processNode).join('');
      return paraText + '\n\n';
    }
    
    if (nodeType === 'bulletList') {
      const items: string[] = [];
      for (const item of content) {
        if (item.type === 'listItem') {
          const itemContent = (item.content || []).map(processNode).join('');
          items.push('- ' + itemContent.trim());
        }
      }
      return items.join('\n') + '\n\n';
    }
    
    if (nodeType === 'text') {
      return text;
    }
    
    return content.map(processNode).join('');
  }
  
  return processNode(content);
}

/**
 * Convert transcript JSON to formatted markdown
 */
export function convertTranscriptToMarkdown(transcriptData: Utterance[] | null | undefined): string {
  if (!transcriptData || !Array.isArray(transcriptData)) {
    return "# Transcript\n\nNo transcript content available.\n";
  }
  
  const lines: string[] = ["# Transcript\n\n"];
  
  for (const utterance of transcriptData) {
    const source = utterance.source || 'unknown';
    const text = utterance.text || '';
    const startTimestamp = utterance.start_timestamp || '';
    
    const speaker = source === "microphone" ? "Microphone" : "System";
    
    let timestampStr = "";
    if (startTimestamp) {
      try {
        const dt = new Date(startTimestamp);
        timestampStr = `[${dt.toISOString().substring(11, 19)}]`;
      } catch {
        timestampStr = "";
      }
    }
    
    lines.push(`**${speaker}** ${timestampStr}\n\n${text}\n\n`);
  }
  
  return lines.join('');
}

/**
 * Sanitize a title to create a valid filename
 * Note: Currently not used, but available for custom filename generation
 */
export function sanitizeFilename(title: string): string {
  const invalidChars = /[<>:"\/\\|?*]/g;
  const filename = title.replace(invalidChars, '');
  return filename.replace(/\s+/g, '_');
}
