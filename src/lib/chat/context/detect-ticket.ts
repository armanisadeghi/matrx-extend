/**
 * Issue tracker / ticket detector.
 *
 * Provider routing: GitHub Issues, Linear, Jira (cloud + server). Surfaces
 * a structured `ticket` context key so the agent has the issue's state,
 * assignee, comments-summary, and labels without scraping the page itself.
 *
 * Companion to `pull_request` — together they cover the dev-workflow
 * trifecta (PR review, issue triage, ticket grooming).
 */

import { log } from '@/lib/debug/log';

export type TicketProvider = 'github-issue' | 'linear' | 'jira';

export interface TicketBundle {
  provider: TicketProvider;
  url: string;
  /** Display key — e.g. "owner/repo#123", "ENG-42", "PROJ-789". */
  key: string;
  title: string | null;
  state: string | null; // 'open' / 'closed' / 'In Progress' / 'Done' — provider-native
  priority: string | null;
  assignee: string | null;
  reporter: string | null;
  labels: string[];
  description_excerpt: string | null;
  comments_count: number | null;
  /** Top related items (linked issues, sub-tasks). */
  related: Array<{ key: string; title: string | null; url: string | null }>;
}

const GH_ISSUE_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/i;
const LINEAR_RE = /^https?:\/\/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/i;
const JIRA_BROWSE_RE = /^https?:\/\/[^/]+\.atlassian\.net\/browse\/([A-Z]+-\d+)/i;

export function isTicketUrl(url: string): boolean {
  return GH_ISSUE_RE.test(url) || LINEAR_RE.test(url) || JIRA_BROWSE_RE.test(url);
}

export async function detectTicket(tabId: number, url: string): Promise<TicketBundle | null> {
  const ghMatch = url.match(GH_ISSUE_RE);
  if (ghMatch) {
    const [, owner, repo, num] = ghMatch;
    return scrapeGitHubIssue(tabId, url, `${owner}/${repo}#${num}`);
  }
  const linearMatch = url.match(LINEAR_RE);
  if (linearMatch) {
    return scrapeLinear(tabId, url, linearMatch[1]!);
  }
  const jiraMatch = url.match(JIRA_BROWSE_RE);
  if (jiraMatch) {
    return scrapeJira(tabId, url, jiraMatch[1]!);
  }
  return null;
}

async function scrapeGitHubIssue(
  tabId: number,
  url: string,
  key: string,
): Promise<TicketBundle | null> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (): Omit<TicketBundle, 'provider' | 'url' | 'key'> => {
        const text = (sel: string): string | null =>
          document.querySelector(sel)?.textContent?.trim() || null;
        const num = (s: string | null): number | null => {
          if (!s) return null;
          const m = s.replace(/[,]/g, '').match(/-?\d+/);
          return m ? Number.parseInt(m[0], 10) : null;
        };

        const title =
          text('bdi.js-issue-title') ??
          text('h1.gh-header-title bdi') ??
          text('[data-testid="issue-title"]') ??
          text('h1');

        const stateEl =
          document.querySelector('.gh-header-meta .State') ??
          document.querySelector('[data-testid="header-state"]');
        const stateRaw = stateEl?.textContent?.trim().toLowerCase() ?? '';
        const state = stateRaw.includes('open')
          ? 'open'
          : stateRaw.includes('closed')
            ? 'closed'
            : stateRaw || null;

        const reporter = text('.gh-header-meta a.author');
        // GitHub Issues sidebar: assignees + labels + projects + milestones
        const assignee =
          document.querySelector('.assignee a.assignee')?.textContent?.trim() ?? null;
        const labels = Array.from(
          document.querySelectorAll('.js-issue-labels a.IssueLabel, [data-testid="label-link"]'),
        )
          .map((el) => el.textContent?.trim() ?? '')
          .filter(Boolean);

        const description =
          document
            .querySelector<HTMLElement>(
              '.timeline-comment .comment-body, [data-testid="markdown-body"]',
            )
            ?.innerText?.trim() ?? null;
        const description_excerpt = description ? description.slice(0, 600) : null;

        const comments_count =
          num(text('#issue-comment-tabs .Counter')) ??
          num(text('a[href$="#issue-comment-tabs"] .Counter')) ??
          null;

        // Linked issues live under "Linked references" / "Development".
        const related: TicketBundle['related'] = [];
        const linkRefs = document.querySelectorAll<HTMLAnchorElement>(
          '.discussion-sidebar-item a[href*="/issues/"], .discussion-sidebar-item a[href*="/pull/"]',
        );
        for (const link of Array.from(linkRefs).slice(0, 5)) {
          const href = link.href;
          const m = href.match(/\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/);
          if (!m) continue;
          related.push({
            key: `${m[1]}/${m[2]}#${m[3]}`,
            title: link.textContent?.trim() || null,
            url: href,
          });
        }

        return {
          title,
          state,
          priority: null, // GitHub Issues has no native priority
          assignee,
          reporter,
          labels,
          description_excerpt,
          comments_count,
          related,
        };
      },
    });
    const result = first?.result;
    if (!result) return null;
    return { provider: 'github-issue', url, key, ...result };
  } catch (err) {
    log.warn('scrape', 'detectTicket (github) failed', err);
    return null;
  }
}

async function scrapeLinear(tabId: number, url: string, key: string): Promise<TicketBundle | null> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (): Omit<TicketBundle, 'provider' | 'url' | 'key'> => {
        // Linear's app is JS-rendered with semantic data attributes.
        const title =
          document.querySelector<HTMLElement>('h1')?.innerText?.trim() ??
          document.querySelector<HTMLElement>('[data-testid="issue-title"]')?.innerText?.trim() ??
          null;

        const stateEl =
          document.querySelector<HTMLElement>('button[aria-label*="status" i]') ??
          document.querySelector<HTMLElement>('[data-testid="status-button"]');
        const state = stateEl?.innerText?.trim() || stateEl?.getAttribute('aria-label') || null;

        const priorityEl = document.querySelector<HTMLElement>('button[aria-label*="priority" i]');
        const priority =
          priorityEl?.innerText?.trim() || priorityEl?.getAttribute('aria-label') || null;

        const assigneeEl = document.querySelector<HTMLElement>('button[aria-label*="assignee" i]');
        const assignee =
          assigneeEl?.getAttribute('aria-label')?.replace(/^assignee:?\s*/i, '') || null;

        const labels = Array.from(
          document.querySelectorAll<HTMLElement>(
            'button[aria-label*="label" i] span, [data-testid*="label"]',
          ),
        )
          .map((el) => el.innerText?.trim() ?? '')
          .filter(Boolean)
          .slice(0, 10);

        // Linear has a description editor with role="textbox" — readonly text accessible.
        const desc =
          document
            .querySelector<HTMLElement>('[contenteditable="true"][aria-label*="description" i]')
            ?.innerText?.trim() ?? null;

        return {
          title,
          state,
          priority,
          assignee,
          reporter: null,
          labels,
          description_excerpt: desc ? desc.slice(0, 600) : null,
          comments_count: null,
          related: [],
        };
      },
    });
    const result = first?.result;
    if (!result) return null;
    return { provider: 'linear', url, key, ...result };
  } catch (err) {
    log.warn('scrape', 'detectTicket (linear) failed', err);
    return null;
  }
}

async function scrapeJira(tabId: number, url: string, key: string): Promise<TicketBundle | null> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (): Omit<TicketBundle, 'provider' | 'url' | 'key'> => {
        const text = (sel: string): string | null =>
          document.querySelector<HTMLElement>(sel)?.innerText?.trim() ?? null;

        const title =
          text('h1[data-testid="issue.views.issue-base.foundation.summary.heading"]') ??
          text('#summary-val') ??
          text('h1');

        const state =
          text('[data-testid="issue.fields.status.common.ui.read-view.status-lozenge.button"]') ??
          text('#status-val .value');

        const priority =
          text('[data-testid="issue.fields.priority.common.ui.read-view.priority"]') ??
          text('#priority-val .value');

        const assignee =
          text('[data-testid="issue.views.field.user.assignee"]') ??
          text('#assignee-val .user-name');

        const reporter =
          text('[data-testid="issue.views.field.user.reporter"]') ??
          text('#reporter-val .user-name');

        const labels = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-testid="issue.views.field.labels.label-link"], #wrap-labels-field a',
          ),
        )
          .map((el) => el.innerText?.trim() ?? '')
          .filter(Boolean);

        const desc =
          text('[data-testid="issue.views.field.rich-text.description"]') ??
          text('#description-val');

        return {
          title,
          state,
          priority,
          assignee,
          reporter,
          labels,
          description_excerpt: desc ? desc.slice(0, 600) : null,
          comments_count: null,
          related: [],
        };
      },
    });
    const result = first?.result;
    if (!result) return null;
    return { provider: 'jira', url, key, ...result };
  } catch (err) {
    log.warn('scrape', 'detectTicket (jira) failed', err);
    return null;
  }
}
