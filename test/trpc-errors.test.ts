import { describe, it, expect } from "bun:test";
import { TRPCClientError } from "@trpc/client";
import { isTrpcUnauthorized } from "@agent-cv/core/src/auth/trpc-errors.ts";

function unauthorizedError(): TRPCClientError {
  return new TRPCClientError("Unauthorized", {
    result: {
      error: {
        message: "Unauthorized",
        code: -32001,
        data: { code: "UNAUTHORIZED", httpStatus: 401 },
      },
    },
  });
}

describe("isTrpcUnauthorized", () => {
  it("returns true when data has httpStatus 401", () => {
    expect(isTrpcUnauthorized(unauthorizedError())).toBe(true);
  });

  it("returns true when data.code is UNAUTHORIZED without httpStatus", () => {
    const e = new TRPCClientError("Unauthorized", {
      result: {
        error: {
          message: "Unauthorized",
          code: -32001,
          data: { code: "UNAUTHORIZED" },
        },
      },
    });
    expect(isTrpcUnauthorized(e)).toBe(true);
  });

  it("returns false for other errors", () => {
    const e = new TRPCClientError("Bad Request", {
      result: {
        error: {
          message: "Bad Request",
          code: -32600,
          data: { code: "BAD_REQUEST", httpStatus: 400 },
        },
      },
    });
    expect(isTrpcUnauthorized(e)).toBe(false);
  });
});
