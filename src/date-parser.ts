/**
 * Parse relative dates (e.g., "last week", "yesterday") into Date objects
 */

/**
 * Get start of day for a given date (00:00:00.000)
 */
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Add days to a date
 */
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Add weeks to a date
 */
function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

/**
 * Add months to a date
 */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Parse a relative or absolute date string into a Date object
 *
 * Supports:
 * - ISO8601 dates: "2025-01-15", "2025-01-15T10:30:00Z"
 * - Relative dates: "today", "yesterday", "last week", "last month"
 * - Patterns: "last N days", "last N weeks", "last N months"
 *
 * @param input - The date string to parse
 * @returns Date object representing the parsed date
 * @throws Error if the date string cannot be parsed
 */
export function parseRelativeDate(input: string): Date {
  if (!input || typeof input !== 'string') {
    throw new Error('Date input must be a non-empty string');
  }

  const lowerInput = input.toLowerCase().trim();
  const now = new Date();

  // Try ISO8601 format first
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) {
    const date = new Date(input);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Handle "today"
  if (lowerInput === 'today') {
    return startOfDay(now);
  }

  // Handle "yesterday"
  if (lowerInput === 'yesterday') {
    return startOfDay(addDays(now, -1));
  }

  // Handle "last week" (7 days ago)
  if (lowerInput === 'last week') {
    return startOfDay(addDays(now, -7));
  }

  // Handle "last month" (1 month ago)
  if (lowerInput === 'last month') {
    return startOfDay(addMonths(now, -1));
  }

  // Handle "this week" (start of current week, Monday)
  if (lowerInput === 'this week') {
    const dayOfWeek = now.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Adjust to Monday
    return startOfDay(addDays(now, diff));
  }

  // Handle "this month" (start of current month)
  if (lowerInput === 'this month') {
    const d = new Date(now);
    d.setDate(1);
    return startOfDay(d);
  }

  // Handle patterns like "last N days/weeks/months"
  const lastNPattern = /last\s+(\d+)\s+(day|week|month)s?/i;
  const match = lowerInput.match(lastNPattern);
  if (match) {
    const count = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    if (isNaN(count) || count <= 0) {
      throw new Error(`Invalid count in date pattern: ${input}`);
    }

    switch (unit) {
      case 'day':
        return startOfDay(addDays(now, -count));
      case 'week':
        return startOfDay(addWeeks(now, -count));
      case 'month':
        return startOfDay(addMonths(now, -count));
    }
  }

  throw new Error(`Cannot parse date: ${input}. Supported formats: ISO8601 (2025-01-15), "today", "yesterday", "last week", "last month", "last N days/weeks/months"`);
}

/**
 * Parse a date range from start and end date strings
 *
 * @param startDate - Start date string (relative or ISO8601)
 * @param endDate - End date string (relative or ISO8601), defaults to "today"
 * @returns Object with start and end Date objects
 */
export function parseDateRange(
  startDate?: string,
  endDate?: string
): { start: Date | null; end: Date | null } {
  let start: Date | null = null;
  let end: Date | null = null;

  try {
    if (startDate) {
      start = parseRelativeDate(startDate);
    }
  } catch (error) {
    console.error(`Failed to parse start date "${startDate}": ${error}`);
  }

  try {
    if (endDate) {
      end = parseRelativeDate(endDate);
      // Set end date to end of day (23:59:59.999)
      end.setHours(23, 59, 59, 999);
    }
  } catch (error) {
    console.error(`Failed to parse end date "${endDate}": ${error}`);
  }

  return { start, end };
}

/**
 * Check if a date falls within a date range
 *
 * @param date - The date to check (ISO8601 string or Date object)
 * @param start - Start of range (null = no lower bound)
 * @param end - End of range (null = no upper bound)
 * @returns true if date is within range
 */
export function isDateInRange(
  date: string | Date | null | undefined,
  start: Date | null,
  end: Date | null
): boolean {
  if (!date) {
    return false;
  }

  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    return false;
  }

  if (start && d < start) {
    return false;
  }

  if (end && d > end) {
    return false;
  }

  return true;
}
