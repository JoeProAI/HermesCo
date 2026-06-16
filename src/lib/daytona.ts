/**
 * Shared Daytona SDK helper.
 */
import { Daytona } from "@daytonaio/sdk";

export function getDaytona(): Daytona {
  if (!process.env.DAYTONA_API_KEY) {
    throw new Error("DAYTONA_API_KEY not configured");
  }
  return new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
    target: (process.env.DAYTONA_TARGET as "us" | "eu") || "us",
  });
}
