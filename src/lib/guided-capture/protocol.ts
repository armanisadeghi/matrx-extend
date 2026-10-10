/** Guided capture — the port protocol between the page overlay and the service worker. */

export const GUIDED_PORT = 'matrx.guided-capture';
/** chrome.storage.session key: which tabs are on a guided job. */
export const GUIDED_TABS_KEY = 'matrx.guided.tabs';

/** What the service worker remembers about a tab it sent a person to. */
export interface GuidedTabJob {
  handoffId: string;
  organizationId: string;
  /** The page the job was opened on (the row's url). */
  url: string;
  title: string;
  /** Social platform vocabulary from `metadata.social.platform`, when the row has it. */
  platform: string | null;
  target: string | null;
  /** The steps the row carries (`what_to_do`); empty = use the recipe's. */
  rowSteps: string;
  /** The Matrx tab that sent the person, so "Back to Matrx" returns there. */
  openerTabId: number | null;
}

/** What the overlay needs to draw itself. */
export interface GuidedJobView {
  url: string;
  handoffId: string;
  title: string;
  platform: string | null;
  target: string | null;
  rowSteps: string;
}

export interface GuidedCapturePayload {
  finalUrl: string;
  title: string;
  text: string;
  html: string;
  itemCount: number;
  images: { src: string; alt?: string; width?: number; height?: number; post_ref?: string }[];
  videos?: { src: string; post_ref?: string; poster?: string; mime_type?: string }[];
  mediaNotes?: string[];
}

export type GuidedClientMsg =
  | { t: 'hello' }
  | { t: 'capture'; payload: GuidedCapturePayload }
  | { t: 'back' }
  | { t: 'finish' };

export type GuidedHostMsg =
  | { t: 'none' }
  | { t: 'job'; job: GuidedJobView }
  | { t: 'filed'; chars: number; items: number; notice: string | null }
  | { t: 'failed'; sentence: string };
