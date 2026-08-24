// Model replies arrive as prose-wrapped text more often than not, especially
// from small models. These helpers recover the artifact without the pipeline
// having to trust the model's formatting discipline.

/** Strip one wrapping ``` fence, keeping only its contents. */
export function stripCodeFences(text: string): string {
  const fenced = /```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n?```/.exec(text);
  return fenced?.[1] !== undefined ? fenced[1] : text;
}

/**
 * Pull the first complete JSON object or array out of a reply, tolerating
 * commentary before and after it. Brace-counting rather than a greedy regex, so
 * trailing prose containing braces cannot break it.
 */
export function extractJson(text: string): string {
  const src = stripCodeFences(text).trim();
  const start = src.search(/[[{]/);
  if (start < 0) throw new Error('No JSON object or array found in the reply');

  const open = src[start] as '[' | '{';
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < src.length; i++) {
    const ch = src[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('JSON in the reply is truncated (unbalanced brackets) — the model likely hit its output limit');
}

/** Parse a model reply as JSON, with a message that helps rather than "Unexpected token". */
export function parseJsonReply<T>(text: string): T {
  const json = extractJson(text);
  try {
    return JSON.parse(json) as T;
  } catch (err) {
    throw new Error(`Reply is not valid JSON: ${(err as Error).message}`);
  }
}
