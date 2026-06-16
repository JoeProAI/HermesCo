/**
 * MCP Hub - Cost Configuration
 * 
 * Credits are charged based on the complexity and typical compute time of each operation.
 * Premium scrapers that require more resources cost more credits.
 */

export const MCP_ACTORS = {
  TWEET_SCRAPER: "apidojo~tweet-scraper",
  PREMIUM_FOLLOWER_SCRAPER: "kaitoeasyapi~premium-x-follower-scraper-following-data",
  INSTAGRAM_SCRAPER: "apify~instagram-scraper",
  YOUTUBE_SCRAPER: "streamers~youtube-scraper",
  TIKTOK_SCRAPER: "clockworks~tiktok-scraper",
  LINKEDIN_SCRAPER: "anchor~linkedin-scraper",
  WEB_SCRAPER: "apify~web-scraper",
};

// Credit costs per action/actor
export const MCP_COSTS: Record<string, number> = {
  // Actions
  scrape_profile: 3,
  scrape_tweets: 5,
  scrape_verified_followers: 8, // Premium actor, higher cost
  list_actors: 0,
  get_dataset: 1,
  
  // Actor-specific costs (when using run_actor directly)
  "apidojo~tweet-scraper": 5,
  "kaitoeasyapi~premium-x-follower-scraper-following-data": 8,
  "apify~instagram-scraper": 6,
  "streamers~youtube-scraper": 5,
  "clockworks~tiktok-scraper": 6,
  "anchor~linkedin-scraper": 7,
  "apify~web-scraper": 4,
  
  // Default for unknown actors
  default: 5,
};

/**
 * Calculate the credit cost for an MCP operation
 */
export function getMcpCost(action: string, actorId?: string): number {
  // First check if there's an action-specific cost
  if (MCP_COSTS[action] !== undefined) {
    return MCP_COSTS[action];
  }
  
  // If running a specific actor, use actor cost
  if (actorId && MCP_COSTS[actorId] !== undefined) {
    return MCP_COSTS[actorId];
  }
  
  // Default cost
  return MCP_COSTS.default;
}

/**
 * Estimate cost for batch operations
 */
export function estimateBatchCost(action: string, count: number): number {
  const baseCost = getMcpCost(action);
  // Batch discount: 10% off for every 10 items after the first 10
  const batches = Math.floor(count / 10);
  const discount = Math.min(batches * 0.1, 0.5); // Max 50% discount
  return Math.ceil(baseCost * count * (1 - discount));
}

/**
 * Get human-readable cost breakdown for UI
 */
export function getCostBreakdown() {
  return {
    scraping: {
      "X Profile": MCP_COSTS.scrape_profile,
      "X Tweets": MCP_COSTS.scrape_tweets,
      "X Verified Followers": MCP_COSTS.scrape_verified_followers,
      "Instagram": MCP_COSTS["apify~instagram-scraper"],
      "YouTube": MCP_COSTS["streamers~youtube-scraper"],
      "TikTok": MCP_COSTS["clockworks~tiktok-scraper"],
      "LinkedIn": MCP_COSTS["anchor~linkedin-scraper"],
      "Web Scraper": MCP_COSTS["apify~web-scraper"],
    },
    utility: {
      "List Tools": MCP_COSTS.list_actors,
      "Get Dataset": MCP_COSTS.get_dataset,
    },
  };
}
