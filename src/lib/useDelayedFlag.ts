"use client";

import { useEffect, useState } from "react";

/** True only after `active` has stayed true for `delayMs`; false again as soon as it ends. */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    if (!active) {
      setFlag(false);
      return;
    }
    const t = setTimeout(() => setFlag(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return flag;
}
