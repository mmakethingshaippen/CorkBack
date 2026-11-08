"use client";

import { useEffect } from "react";
import { RESET_PASSWORD_PATH } from "@/lib/appUrl";

/**
 * Supabase Site URL fallback, client half. When an email link falls back to
 * the homepage with credentials in the URL hash (the server never sees the
 * hash), forward them into the recovery flow instead of leaving the user on
 * the board. Renders nothing and logs nothing.
 */
export function AuthHashForwarder() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    const params = new URLSearchParams(hash.slice(1));

    if (params.get("error_code") || params.get("error")) {
      const expired = params.get("error_code") === "otp_expired";
      window.location.replace(`/sign-in?error=${expired ? "link_expired" : "link_invalid"}`);
      return;
    }
    if (params.get("access_token")) {
      if (params.get("type") === "recovery") {
        // Keep the hash so the reset page can establish the recovery session.
        window.location.replace(RESET_PASSWORD_PATH + hash);
      } else {
        // Not a recovery link: drop the tokens from the address bar.
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
  }, []);
  return null;
}
