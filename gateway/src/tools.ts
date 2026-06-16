import { search, SafeSearchType } from "duck-duck-scrape";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearch(query: string, maxResults: number = 5): Promise<SearchResult[]> {
  try {
    const results = await search(query, {
      safeSearch: SafeSearchType.MODERATE,
    });

    return results.results.slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  } catch (error) {
    console.error("[Tools] Web search failed:", error);
    return [];
  }
}

export const TOOL_DEFINITIONS = {
  anthropic: [
    {
      name: "web_search",
      description: "Search the web for current information. Use this when you need to find up-to-date information, facts, news, or research topics.",
      input_schema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "The search query",
          },
        },
        required: ["query"],
      },
    },
  ],
  openai: [
    {
      type: "function" as const,
      function: {
        name: "web_search",
        description: "Search the web for current information. Use this when you need to find up-to-date information, facts, news, or research topics.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query",
            },
          },
          required: ["query"],
        },
      },
    },
  ],
};

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "web_search":
      const results = await webSearch(args.query as string);
      if (results.length === 0) {
        return "No search results found.";
      }
      return results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join("\n\n");
    default:
      return `Unknown tool: ${name}`;
  }
}
