/**
 * GitHub / GitLab pull-request page detector.
 *
 * Triggers when the URL matches `github.com/{owner}/{repo}/pull/{N}` or
 * `gitlab.com/.../merge_requests/{N}`. Surfaces a structured `pull_request`
 * context key so the agent doesn't burn turns scraping the diff page.
 *
 * Dev workflow #1 in the field research. PRs >500 lines rarely get
 * properly reviewed by humans — this is exactly where agent value compounds.
 */

import { log } from '@/lib/debug/log';

export interface PullRequestBundle {
  provider: 'github' | 'gitlab';
  url: string;
  repo: string; // "owner/name"
  pr_number: number;
  title: string | null;
  author: string | null;
  state: 'open' | 'merged' | 'closed' | 'draft' | 'unknown';
  base_branch: string | null;
  head_branch: string | null;
  files_changed: number | null;
  additions: number | null;
  deletions: number | null;
  /** Top files by churn (additions + deletions). */
  top_files: Array<{ path: string; additions: number | null; deletions: number | null }>;
  review_summary: {
    approvals: number;
    comments: number;
    requested_changes: number;
  };
  /** True when the diff tab is the active view (vs Conversation/Commits/Checks). */
  on_files_tab: boolean;
}

const GITHUB_PR_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i;
const GITLAB_MR_RE = /^https?:\/\/(?:www\.)?gitlab\.com\/(.+)\/-\/merge_requests\/(\d+)/i;

export function isPullRequestUrl(url: string): boolean {
  return GITHUB_PR_RE.test(url) || GITLAB_MR_RE.test(url);
}

export async function detectPullRequest(
  tabId: number,
  url: string,
): Promise<PullRequestBundle | null> {
  const ghMatch = url.match(GITHUB_PR_RE);
  if (ghMatch) {
    const [, owner, repo, num] = ghMatch;
    return scrapeGitHubPR(tabId, url, `${owner}/${repo}`, Number.parseInt(num!, 10));
  }
  const glMatch = url.match(GITLAB_MR_RE);
  if (glMatch) {
    const [, repoPath, num] = glMatch;
    return scrapeGitLabMR(tabId, url, repoPath!, Number.parseInt(num!, 10));
  }
  return null;
}

async function scrapeGitHubPR(
  tabId: number,
  url: string,
  repo: string,
  prNumber: number,
): Promise<PullRequestBundle | null> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (): Omit<PullRequestBundle, 'provider' | 'url' | 'repo' | 'pr_number'> => {
        const text = (sel: string): string | null => {
          const el = document.querySelector(sel);
          return el?.textContent?.trim() || null;
        };
        const num = (s: string | null): number | null => {
          if (!s) return null;
          const m = s.replace(/[,]/g, '').match(/-?\d+/);
          return m ? Number.parseInt(m[0], 10) : null;
        };

        // Title — both old and new GitHub layouts.
        const title =
          text('bdi.js-issue-title') ??
          text('h1.gh-header-title bdi') ??
          text('[data-testid="issue-title"]') ??
          text('h1');

        // Author — header meta link with class `author`.
        const author =
          text('.gh-header-meta a.author') ?? text('[data-testid="pr-meta-author"] a') ?? null;

        // State — `.State` element with State--{open|merged|closed} modifier.
        // Newer layout uses [data-testid="header-state"].
        const stateEl =
          document.querySelector('.gh-header-meta .State') ??
          document.querySelector('[data-testid="header-state"]') ??
          null;
        const stateText = stateEl?.textContent?.trim().toLowerCase() ?? '';
        let state: PullRequestBundle['state'] = 'unknown';
        if (stateText.includes('draft')) state = 'draft';
        else if (stateText.includes('open')) state = 'open';
        else if (stateText.includes('merged')) state = 'merged';
        else if (stateText.includes('closed')) state = 'closed';

        // Base / head branches — `.commit-ref` elements (two of them in header).
        const refs = Array.from(document.querySelectorAll('.gh-header-meta .commit-ref'));
        // Order is base ← head (head is the "compare" side).
        const baseBranch = refs[0]?.textContent?.trim() || null;
        const headBranch = refs[1]?.textContent?.trim() || null;

        // Files changed counter — `#files_tab_counter` is the canonical badge.
        const filesChanged = num(text('#files_tab_counter') ?? text('a[href$="/files"] .Counter'));

        // Additions / deletions — diffstat lives near the header.
        const additions = num(
          text('.diffstat .color-fg-success') ?? text('[data-testid="pr-stats-additions"]'),
        );
        const deletions = num(
          text('.diffstat .color-fg-danger') ?? text('[data-testid="pr-stats-deletions"]'),
        );

        // On-files-tab detection.
        const onFilesTab = /\/files(?:[/?#]|$)/.test(location.pathname + location.search);

        // Review summary — sidebar shows reviewers with their state.
        let approvals = 0;
        let requested_changes = 0;
        const reviewerItems = document.querySelectorAll<HTMLElement>(
          '.discussion-sidebar-item .reviewers-status-icon, [data-testid="reviewers-list"] svg',
        );
        for (const r of Array.from(reviewerItems)) {
          const cls = (r.getAttribute('class') ?? '') + ' ' + (r.getAttribute('aria-label') ?? '');
          if (/approved|color-fg-success/i.test(cls)) approvals++;
          else if (/changes-requested|color-fg-danger/i.test(cls)) requested_changes++;
        }
        // Fall back to comment count from the timeline summary.
        const comments =
          num(
            text('#conversation_tab_counter') ?? text('a[href$="#issue-comment-tabs"] .Counter'),
          ) ?? 0;

        // Top files by churn — only when on the Files Changed tab.
        const topFiles: PullRequestBundle['top_files'] = [];
        if (onFilesTab) {
          const fileBlocks = Array.from(document.querySelectorAll('div.file[data-tagsearch-path]'));
          for (const f of fileBlocks.slice(0, 15)) {
            const path = f.getAttribute('data-tagsearch-path') || '';
            const stats = f.querySelector('.file-info .diffstat');
            const additions =
              stats?.querySelector('.color-fg-success')?.textContent?.trim() ?? null;
            const deletions = stats?.querySelector('.color-fg-danger')?.textContent?.trim() ?? null;
            topFiles.push({
              path,
              additions: additions ? num(additions) : null,
              deletions: deletions ? num(deletions) : null,
            });
          }
          // Sort by churn desc.
          topFiles.sort(
            (a, b) =>
              (b.additions ?? 0) + (b.deletions ?? 0) - ((a.additions ?? 0) + (a.deletions ?? 0)),
          );
        }

        return {
          title,
          author,
          state,
          base_branch: baseBranch,
          head_branch: headBranch,
          files_changed: filesChanged,
          additions,
          deletions,
          top_files: topFiles,
          review_summary: { approvals, comments, requested_changes },
          on_files_tab: onFilesTab,
        };
      },
    });
    const result = first?.result;
    if (!result) return null;
    return { provider: 'github', url, repo, pr_number: prNumber, ...result };
  } catch (err) {
    log.warn('scrape', 'detectPullRequest (github) failed', err);
    return null;
  }
}

async function scrapeGitLabMR(
  tabId: number,
  url: string,
  repo: string,
  mrNumber: number,
): Promise<PullRequestBundle | null> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (): Omit<PullRequestBundle, 'provider' | 'url' | 'repo' | 'pr_number'> => {
        const text = (sel: string): string | null => {
          const el = document.querySelector(sel);
          return el?.textContent?.trim() || null;
        };
        const num = (s: string | null): number | null => {
          if (!s) return null;
          const m = s.replace(/[,]/g, '').match(/-?\d+/);
          return m ? Number.parseInt(m[0], 10) : null;
        };

        const title = text('h1.title, .merge-request-title-text, [data-testid="title"] h2');
        const author = text('.author-link, [data-testid="author-link"]');

        const stateEl =
          document.querySelector('[data-testid="status-badge"]') ??
          document.querySelector('.issuable-status-badge');
        const stateText = stateEl?.textContent?.trim().toLowerCase() ?? '';
        let state: PullRequestBundle['state'] = 'unknown';
        if (stateText.includes('draft')) state = 'draft';
        else if (stateText.includes('open')) state = 'open';
        else if (stateText.includes('merged')) state = 'merged';
        else if (stateText.includes('closed')) state = 'closed';

        const baseBranch = text('.ref-container.ref-target') ?? text('[data-testid="ref-target"]');
        const headBranch = text('.ref-container.ref-source') ?? text('[data-testid="ref-source"]');

        const filesChanged = num(
          text('a[href$="/diffs"] .gl-badge') ?? text('[data-testid="diffs-counter"]'),
        );

        const onFilesTab = /\/diffs(?:[/?#]|$)/.test(location.pathname);

        return {
          title,
          author,
          state,
          base_branch: baseBranch,
          head_branch: headBranch,
          files_changed: filesChanged,
          additions: null,
          deletions: null,
          top_files: [],
          review_summary: { approvals: 0, comments: 0, requested_changes: 0 },
          on_files_tab: onFilesTab,
        };
      },
    });
    const result = first?.result;
    if (!result) return null;
    return { provider: 'gitlab', url, repo, pr_number: mrNumber, ...result };
  } catch (err) {
    log.warn('scrape', 'detectPullRequest (gitlab) failed', err);
    return null;
  }
}
