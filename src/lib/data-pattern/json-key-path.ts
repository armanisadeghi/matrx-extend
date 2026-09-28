/** Existing saved strings are dotted paths. New tree selections are exact key segments. */
export type JsonKeyPath = string | string[];

export function jsonKeyPathSegments(path: JsonKeyPath | undefined): readonly string[] {
  return typeof path === 'string' ? path.split('.').filter(Boolean) : (path ?? []);
}

/** Display only. Resolution never parses this string back into keys. */
export function formatJsonKeyPath(path: readonly string[]): string {
  let display = '';
  for (const key of path) {
    if (!key || /[.[\]\\]/.test(key)) display += `[${JSON.stringify(key)}]`;
    else display += display ? `.${key}` : key;
  }
  return display;
}
