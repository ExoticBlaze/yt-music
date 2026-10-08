export interface BlockingStatus {
  enabled: boolean;
  blockedRequests: number;
  filteredResponses: number;
  skippedAds: number;
  filterCount: number;
  source: string;
  lastUpdated: string | null;
}
