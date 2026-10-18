export type ParsedSegment =
  | { type: 'text'; content: string }
  | { type: 'tag'; content: string; tag: string }
  | {
      type: 'link';
      content: string;
      displayText: string;
      url: string;
      isFilePath: boolean;
    };

// Regex patterns for link detection
// One pair of parentheses inside the address is part of the URL, as in a
// Wikipedia title. The final `)` still closes the markdown link.
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(((?:[^()]|\([^()]*\))+)\)/;
const FULL_URL_REGEX = /https?:\/\/[^\s]+/;
const WWW_URL_REGEX = /www\.[^\s]+/;
const UNIX_PATH_REGEX = /^\/[^\s/]+\/[^\s]*$/;
const WINDOWS_PATH_REGEX = /^[A-Z]:\\(?:[^\s\\]+\\)*[^\s\\]+$/i;

/**
 * Strips trailing punctuation from a URL
 */
function stripTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0 && /[.,;:!?)\]"']/.test(url[end - 1])) {
    const last = url[end - 1];
    // A Wikipedia title ends in a real parenthesis. Drop that character
    // only when it does not close an opening parenthesis in the URL.
    if (last === ')' || last === ']') {
      const open = last === ')' ? '(' : '[';
      const slice = url.slice(0, end);
      const opens = slice.split(open).length - 1;
      const closes = slice.split(last).length - 1;
      if (opens >= closes) {
        break;
      }
    }
    end -= 1;
  }
  return url.slice(0, end);
}

/**
 * Normalizes a URL by adding protocol if missing
 */
export function normalizeUrl(rawUrl: string): string {
  // Already has protocol
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    return rawUrl;
  }

  // www. URL - add https://
  if (rawUrl.startsWith('www.')) {
    return `https://${rawUrl}`;
  }

  // File path - convert to file:// URL
  if (rawUrl.startsWith('/') || /^[A-Z]:\\/i.test(rawUrl)) {
    return `file://${rawUrl}`;
  }

  return rawUrl;
}

/**
 * Parses a single word for hashtags (existing logic from NotesTagFormatter)
 * Returns segments for tags found in the word
 */
function parseTagsInWord(word: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];

  if (!word.includes('#') || word.length <= 1) {
    return [{ type: 'text', content: word }];
  }

  let lastEmptyTag = -1;
  const parts = word.split('#');

  parts.forEach((tag, ti) => {
    if (ti === 0) {
      if (tag) {
        segments.push({ type: 'text', content: tag });
      }
      return;
    }

    if (!tag) {
      lastEmptyTag = ti;
      segments.push({ type: 'text', content: '#' });
      return;
    }

    if (lastEmptyTag === ti - 1) {
      segments.push({ type: 'text', content: `${tag}` });
      return;
    }
    lastEmptyTag = -1;

    const validTag = `#${tag}`;
    segments.push({ type: 'tag', content: validTag, tag });
  });

  return segments;
}

/**
 * Parses notes string into segments of text, tags, and links
 */
export function parseNotes(notes: string): ParsedSegment[] {
  if (!notes) {
    return [];
  }

  const segments: ParsedSegment[] = [];
  let remaining = notes;

  while (remaining.length > 0) {
    const markdownMatch = remaining.match(MARKDOWN_LINK_REGEX);
    const urlMatch = remaining.match(FULL_URL_REGEX);
    const wwwMatch = remaining.match(WWW_URL_REGEX);

    const candidates = [
      markdownMatch?.index !== undefined
        ? { type: 'markdown' as const, match: markdownMatch }
        : null,
      urlMatch?.index !== undefined
        ? { type: 'url' as const, match: urlMatch }
        : null,
      wwwMatch?.index !== undefined
        ? { type: 'www' as const, match: wwwMatch }
        : null,
    ].filter(item => item !== null);

    if (candidates.length === 0) {
      // No more links found, parse remaining text with tags
      segments.push(...parseTextWithTags(remaining));
      break;
    }

    candidates.sort((a, b) => a.match.index! - b.match.index!);
    const earliest = candidates[0];
    const matchIndex = earliest.match.index!;

    if (earliest.type === 'markdown') {
      if (matchIndex > 0) {
        const textBefore = remaining.slice(0, matchIndex);
        segments.push(...parseTextWithTags(textBefore));
      }

      const [fullMatch, displayText, url] = earliest.match;
      const isFilePath =
        url.startsWith('/') ||
        /^[A-Z]:\\/i.test(url) ||
        url.startsWith('file://');
      segments.push({
        type: 'link',
        content: fullMatch,
        displayText,
        url,
        isFilePath,
      });

      remaining = remaining.slice(matchIndex + fullMatch.length);
      continue;
    }

    if (matchIndex > 0) {
      const textBefore = remaining.slice(0, matchIndex);
      segments.push(...parseTextWithTags(textBefore));
    }

    const rawUrl = earliest.match[0];
    const url = stripTrailingPunctuation(rawUrl);

    segments.push({
      type: 'link',
      content: url,
      displayText: url,
      url,
      isFilePath: false,
    });

    remaining = remaining.slice(matchIndex + url.length);
  }

  return segments;
}

/**
 * Parses text that may contain hashtags and file paths
 */
function parseTextWithTags(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  const words = text.split(/(\s+)/); // Split but keep whitespace

  for (const word of words) {
    // Check if it's whitespace
    if (/^\s+$/.test(word)) {
      segments.push({ type: 'text', content: word });
      continue;
    }

    // Check if it's a file path
    if (UNIX_PATH_REGEX.test(word) || WINDOWS_PATH_REGEX.test(word)) {
      segments.push({
        type: 'link',
        content: word,
        displayText: word,
        url: word,
        isFilePath: true,
      });
      continue;
    }

    // Check for hashtags
    if (word.includes('#') && word.length > 1) {
      segments.push(...parseTagsInWord(word));
      continue;
    }

    // Plain text
    if (word) {
      segments.push({ type: 'text', content: word });
    }
  }

  return segments;
}
