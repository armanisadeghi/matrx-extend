import { z } from 'zod';

export const QuickScrapeRequestSchema = z.object({
  url: z.string().url().optional(),
  html: z.string().optional(),
  ai_clean: z.boolean().default(false),
  agent_id: z.string().optional(),
});
export type QuickScrapeRequest = z.infer<typeof QuickScrapeRequestSchema>;

export const SearchKeywordsRequestSchema = z.object({
  topic_id: z.string().uuid(),
  keywords: z.array(z.string()).optional(),
});
export type SearchKeywordsRequest = z.infer<typeof SearchKeywordsRequestSchema>;

export const QUICK_SCRAPE_PATH = '/scraper/quick-scrape';
export const SCRAPER_SEARCH_PATH = '/scraper/search';
export const SCRAPER_SEARCH_AND_SCRAPE_PATH = '/scraper/search-and-scrape';
export const SCRAPER_MIC_CHECK_PATH = '/scraper/mic-check';
