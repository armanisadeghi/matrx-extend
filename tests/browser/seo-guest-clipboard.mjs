// Public-page facts are gathered from the owned tab, independently of the
// extension audit. Only booleans leave this verifier for the native receipt.
export function verifyGuestCopy(summary, ai, publicPage) {
  const lines = summary.split('\n');
  const title = publicPage.title;
  const url = publicPage.url;
  if (
    lines[0] !== `URL: ${url}` ||
    lines[1] !== `Title (${title.length} chars): ${title}` ||
    !lines.some((line) => line.startsWith('Description (')) ||
    !lines.includes('Page stats:') ||
    (publicPage.heading && !summary.includes(publicPage.heading))
  )
    throw new Error('seo_clipboard_text_does_not_match_public_page');
  const expectedAi = [
    'The following is an SEO audit for a webpage.',
    '',
    `- Source URL: ${url}`,
    `- Title: ${title}`,
    '',
    '```',
    summary.trimEnd(),
    '```',
  ].join('\n');
  if (ai !== expectedAi) throw new Error('seo_clipboard_ai_format_or_content_mismatch');
  return { textMatchesPublicPage: true, aiWrapsExactSummary: true };
}
