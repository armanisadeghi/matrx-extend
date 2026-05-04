/**
 * Auth-state probe — "are we logged in on this domain?"
 *
 * Universal need: every browser agent today struggles with login walls
 * and 2FA. Knowing the answer up front saves a wasted turn ("let me check
 * if you're signed in") and lets the agent decide between proceeding,
 * navigating, or escalating to `request_user_takeover`.
 *
 * Heuristic — we can't introspect cookies (admin permission) so we infer
 * from visible chrome:
 *
 *   signed_in = "yes"      → strong positive signal (user chip + sign-out)
 *   signed_in = "likely"   → one positive signal
 *   signed_in = "no"       → visible sign-in / log-in CTA dominates
 *   signed_in = "unknown"  → can't tell from this page
 *
 * The user chip extraction is best-effort — when it works it's gold for
 * the agent ("you're acting as armanisadeghi on github.com"), when it
 * doesn't we still ship the boolean.
 */

import { log } from '@/lib/debug/log';

export interface AuthState {
  domain: string;
  signed_in: 'yes' | 'likely' | 'no' | 'unknown';
  user_chip: string | null;
  signals: {
    sign_out_link: boolean;
    profile_chip: boolean;
    avatar_image: boolean;
    sign_in_cta: boolean;
    login_form_visible: boolean;
  };
}

export async function checkAuthState(tabId: number, url: string): Promise<AuthState | null> {
  let domain = '';
  try {
    domain = new URL(url).hostname;
  } catch {
    return null;
  }
  if (!domain) return null;

  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (hostname: string): AuthState => {
        // Visible-only: dropdowns and side menus may have these as
        // hidden text — that doesn't count as "signed in" signal.
        function isVisible(el: Element): boolean {
          if (!(el instanceof HTMLElement)) return false;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return false;
          const style = window.getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') return false;
          if (parseFloat(style.opacity || '1') === 0) return false;
          return true;
        }

        function findVisible<T extends Element>(selector: string): T | null {
          const els = document.querySelectorAll<T>(selector);
          for (const el of Array.from(els)) {
            if (isVisible(el)) return el;
          }
          return null;
        }

        // Sign-out link / button. Strong positive signal.
        const SIGN_OUT_SELECTORS = [
          'a[href*="logout" i]',
          'a[href*="sign-out" i]',
          'a[href*="signout" i]',
          'button[aria-label*="sign out" i]',
          'button[aria-label*="log out" i]',
        ];
        const SIGN_OUT_TEXT_RE = /^(sign\s*out|log\s*out|logout)$/i;
        let signOutLink = false;
        for (const sel of SIGN_OUT_SELECTORS) {
          if (findVisible(sel)) {
            signOutLink = true;
            break;
          }
        }
        // Text-based fallback — covers SPA buttons without href.
        if (!signOutLink) {
          const buttons = Array.from(
            document.querySelectorAll<HTMLElement>('button, a, [role="menuitem"]'),
          );
          for (const b of buttons) {
            if (!isVisible(b)) continue;
            const t = (b.innerText ?? '').trim();
            if (SIGN_OUT_TEXT_RE.test(t)) {
              signOutLink = true;
              break;
            }
          }
        }

        // Avatar in the page header / top-right. Common SaaS pattern.
        const avatar =
          findVisible<HTMLElement>(
            'header img[alt*="avatar" i], header img[alt*="profile" i], [role="banner"] img[alt*="avatar" i]',
          ) ??
          findVisible<HTMLElement>('header [class*="avatar" i] img') ??
          findVisible<HTMLElement>('[data-testid*="avatar" i]');
        const avatarImage = !!avatar;

        // Profile chip with name — try to lift the visible username.
        const PROFILE_SELECTORS = [
          'header [data-testid*="profile" i]',
          'header [aria-label*="profile" i]',
          'header [data-testid*="user-menu" i]',
          'button[aria-label*="user" i][aria-haspopup]',
          'header a[href*="/u/" i]',
          'header a[href*="/users/" i]',
        ];
        let profileChipEl: HTMLElement | null = null;
        for (const sel of PROFILE_SELECTORS) {
          const el = findVisible<HTMLElement>(sel);
          if (el) {
            profileChipEl = el;
            break;
          }
        }
        const profileChip = !!profileChipEl;

        // User chip text — short non-empty string from chip / avatar alt.
        let userChip: string | null = null;
        if (profileChipEl) {
          const al = profileChipEl.getAttribute('aria-label');
          if (al) {
            // Common pattern: "Open user menu, armanisadeghi"
            const m = al.match(/[,:]\s*([A-Za-z0-9_.-]{2,40})\s*$/);
            if (m) userChip = m[1] ?? null;
            else if (/^[A-Za-z0-9_.-]{2,40}$/.test(al)) userChip = al;
          }
          if (!userChip) {
            const t = (profileChipEl.innerText ?? '').trim();
            if (t && t.length <= 40 && !/sign\s*in|log\s*in/i.test(t)) {
              userChip = t.split('\n')[0]?.trim() ?? null;
            }
          }
        }
        if (!userChip && avatar instanceof HTMLImageElement && avatar.alt) {
          // Alt of avatar often is the username, sometimes "armanisadeghi"
          // or "armanisadeghi avatar".
          const alt = avatar.alt.replace(/(?:'s)?\s*(?:avatar|profile|picture|photo)$/i, '').trim();
          if (alt && alt.length <= 40 && !/avatar|profile/i.test(alt)) userChip = alt;
        }

        // Sign-in / log-in CTA — visible button or link with sign-in copy.
        const SIGN_IN_TEXT_RE = /^(sign\s*in|log\s*in|login|register|sign\s*up|create\s*account)$/i;
        let signInCta = false;
        const ctaCandidates = Array.from(
          document.querySelectorAll<HTMLElement>(
            'header a, header button, [role="banner"] a, [role="banner"] button, nav a, nav button',
          ),
        );
        for (const el of ctaCandidates) {
          if (!isVisible(el)) continue;
          const t = (el.innerText ?? '').trim();
          if (SIGN_IN_TEXT_RE.test(t)) {
            signInCta = true;
            break;
          }
        }

        // Login form on the page (password field visible).
        const passwordInput = findVisible<HTMLInputElement>('input[type="password"]');
        const loginFormVisible = !!passwordInput;

        // ── Verdict ─────────────────────────────────────────────────────────
        // Strong positives outweigh ambiguous negatives — a logged-in user
        // can still see "Sign up" links pointing other sections at them.
        let signedIn: AuthState['signed_in'];
        if (signOutLink) {
          signedIn = 'yes';
        } else if (loginFormVisible && !profileChip && !avatarImage) {
          signedIn = 'no';
        } else if (signInCta && !profileChip && !avatarImage) {
          signedIn = 'no';
        } else if (profileChip || avatarImage) {
          signedIn = 'likely';
        } else {
          signedIn = 'unknown';
        }

        return {
          domain: hostname,
          signed_in: signedIn,
          user_chip: userChip,
          signals: {
            sign_out_link: signOutLink,
            profile_chip: profileChip,
            avatar_image: avatarImage,
            sign_in_cta: signInCta,
            login_form_visible: loginFormVisible,
          },
        };
      },
      args: [domain],
    });
    return (first?.result as AuthState | undefined) ?? null;
  } catch (err) {
    log.warn('scrape', 'checkAuthState failed', err);
    return null;
  }
}
