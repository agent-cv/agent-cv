import { useEffect } from "react";
import { writeAuthToken } from "@agent-cv/core/src/auth/index.ts";

/** Clear stored JWT when the machine surfaces a session-expired error (user must sign in again). */
export function useClearAuthOnSessionExpired(isFailed: boolean, errorMessage: string): void {
  useEffect(() => {
    if (!isFailed) return;
    if (!errorMessage.includes("Session expired")) return;
    void writeAuthToken({ jwt: "", username: "", obtainedAt: "" });
  }, [isFailed, errorMessage]);
}
