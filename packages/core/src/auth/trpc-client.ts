import { createTRPCProxyClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import superjson from "superjson";

function trpcHttpUrl(): string {
  const raw = (process.env.AGENT_CV_API_URL ?? "").trim() || "https://agent-cv.dev";
  return `${raw.replace(/\/+$/, "")}/api/trpc`;
}

/**
 * tRPC client for agent-cv.dev HTTP API (publish, auth device poll, unpublish).
 * AppRouter types live in the web app; CLI uses a narrow untyped proxy.
 */
export function createAgentCvTrpcClient(authToken?: string) {
  return createTRPCProxyClient({
    links: [
      httpBatchLink({
        url: trpcHttpUrl(),
        transformer: superjson,
        headers() {
          const h: Record<string, string> = {};
          if (authToken) {
            h.Authorization = `Bearer ${authToken}`;
          }
          return h;
        },
      }),
    ],
  });
}

export { TRPCClientError };
