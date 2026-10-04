export function observeScrapeRows(content: Element): {
  imageItems: Array<{
    href: string;
    src: string | null;
    alt: string | null;
    complete: boolean;
    naturalWidth: number;
    naturalHeight: number;
  }>;
  videoItems: Array<{ href: string; text: string }>;
  linkItems: Array<{ href: string; text: string }>;
};
