"use client";

import { useSyncExternalStore } from "react";
import {
  INITIAL_UNREAD_STATE,
  applyUnreadResult,
  classifyUnreadResponse,
  shouldStopUnread,
  totalUnread,
  type UnreadClientState,
  type UnreadFetchResult,
} from "@/lib/unread";

export const UNREAD_CHANGED_EVENT = "cb:unread-changed";
const POLL_MS = 60_000;

export interface UnreadCounts {
  total: number;
  byThread: Record<string, number>;
}

/**
 * Module-level store so BottomNav and InboxList share one poller per page.
 * The poller runs only while at least one component is subscribed. State is
 * reset when the last subscriber leaves, so a later page (e.g. after signing
 * in) starts fresh. Nothing here runs during render.
 */
let state: UnreadClientState = INITIAL_UNREAD_STATE;
let snapshot: UnreadCounts | null = null;
let inFlight = false;
let timer: number | null = null;
const listeners = new Set<() => void>();

function publish(next: UnreadClientState) {
  state = next;
  if (next.supported === true && !next.stopped) {
    const same = snapshot && snapshot.total === next.total && sameThreads(snapshot.byThread, next.byThread);
    if (!same) snapshot = { total: totalUnread(next.byThread), byThread: next.byThread };
  } else {
    snapshot = null; // unsupported or signed out: show nothing
  }
  listeners.forEach((l) => l());
}

function sameThreads(a: Record<string, number>, b: Record<string, number>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}

async function refresh(): Promise<void> {
  if (inFlight || shouldStopUnread(state)) return;
  if (document.visibilityState === "hidden") return;
  inFlight = true;
  let result: UnreadFetchResult;
  try {
    const res = await fetch("/api/messages/unread", { cache: "no-store" });
    const body = await res.json().catch(() => null);
    result = classifyUnreadResponse(res.status, body);
  } catch {
    result = { kind: "failed" };
  } finally {
    inFlight = false;
  }
  if (listeners.size === 0) return; // unsubscribed while fetching
  publish(applyUnreadResult(state, result));
  if (shouldStopUnread(state)) stopTimer();
}

function stopTimer() {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

const onWake = () => { void refresh(); };
const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };

function start() {
  window.addEventListener("focus", onWake);
  window.addEventListener(UNREAD_CHANGED_EVENT, onWake);
  document.addEventListener("visibilitychange", onVisibility);
  timer = window.setInterval(onWake, POLL_MS);
  void refresh();
}

function stop() {
  window.removeEventListener("focus", onWake);
  window.removeEventListener(UNREAD_CHANGED_EVENT, onWake);
  document.removeEventListener("visibilitychange", onVisibility);
  stopTimer();
  state = INITIAL_UNREAD_STATE;
  snapshot = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => null;

/** Unread counts, or null while unknown, unsupported or signed out. */
export function useUnreadCount(): UnreadCounts | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
