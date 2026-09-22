"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { IDLE_TIMEOUT_SECONDS } from "@/lib/auth/idle-timeout-constants";

const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_SECONDS * 1000;
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;

/** Keeps the server-side idle clock aligned with activity inside an open page. */
export function IdleTimeoutWatcher() {
  useEffect(() => {
    const supabase = createClient();
    let lastActivityAt = Date.now();
    let lastHeartbeatAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;

    async function expireSession() {
      if (expired) return;
      expired = true;
      await supabase.auth.signOut({ scope: "local" });
      window.location.replace("/login?error=idle");
    }

    function scheduleExpiryCheck() {
      if (timer) clearTimeout(timer);
      const remaining = Math.max(0, IDLE_TIMEOUT_MS - (Date.now() - lastActivityAt));
      timer = setTimeout(() => {
        if (Date.now() - lastActivityAt >= IDLE_TIMEOUT_MS) {
          void expireSession();
        } else {
          scheduleExpiryCheck();
        }
      }, remaining);
    }

    function sendHeartbeat() {
      const now = Date.now();
      if (now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
      lastHeartbeatAt = now;
      void fetch("/api/auth/heartbeat", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      }).then((response) => {
        if (response.status === 401 || response.redirected) void expireSession();
      }).catch(() => {
        // A transient network failure should not sign the user out. The next
        // activity event will retry, while the server boundary remains strict.
      });
    }

    function markActivity() {
      if (expired) return;
      const now = Date.now();
      if (now - lastActivityAt >= IDLE_TIMEOUT_MS) {
        void expireSession();
        return;
      }
      lastActivityAt = now;
      sendHeartbeat();
      scheduleExpiryCheck();
    }

    const events: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "scroll",
      "touchstart",
      "focus",
    ];
    events.forEach((event) => window.addEventListener(event, markActivity, { passive: true }));
    document.addEventListener("visibilitychange", markActivity);
    scheduleExpiryCheck();

    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, markActivity));
      document.removeEventListener("visibilitychange", markActivity);
    };
  }, []);

  return null;
}
