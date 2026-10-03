export type Freshness = 'day' | 'week' | 'month' | 'year' | 'any';
export interface SearchQuery { query: string; limit: number; language: 'ar'|'en'|'auto'; freshness: Freshness; }
export interface SearchResult { title: string; url: string; snippet: string; source: string; published_at: string | null; }
export interface SearchProvider { readonly name: string; search(query: SearchQuery): Promise<SearchResult[]>; health(): Promise<boolean>; }
