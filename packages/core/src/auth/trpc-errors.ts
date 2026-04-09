import type { TRPCClientError } from "@trpc/client";

/**
 * Detect session/auth failures from tRPC client errors (HTTP 401 / UNAUTHORIZED).
 */
export function isTrpcUnauthorized(e: TRPCClientError<any>): boolean {
  const data = e.data as { code?: string; httpStatus?: number } | undefined;
  if (data?.httpStatus === 401 || data?.code === "UNAUTHORIZED") {
    return true;
  }
  const shape = e.shape as { data?: { code?: string; httpStatus?: number } } | undefined;
  const shapeData = shape?.data;
  if (shapeData?.httpStatus === 401 || shapeData?.code === "UNAUTHORIZED") {
    return true;
  }
  return false;
}
