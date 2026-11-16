"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Bounds } from "./mapBounds";
import {
  buildMapRequest,
  createMapRequestModel,
  type MapRequestMode,
  type MapRequestModel,
  type MapRequestState,
  type MapResult,
} from "./mapRequestModel";

export interface UseMapPostingsOptions {
  mode: MapRequestMode;
  /** null or "" for all categories. */
  category: string | null;
  /** Bounds to fetch; null waits (for example before the map's first moveend). */
  bounds: Bounds | null;
  /** Delay before fetching after bounds change. 0 fetches immediately. World map uses 400. */
  debounceMs?: number;
}

export interface UseMapPostingsResult<T> extends MapRequestState<T> {
  retry: () => void;
}

export const WORLD_MAP_DEBOUNCE_MS = 400;

const FALLBACK_ERROR = "Could not load postings. Try again.";

export function useMapPostings<T = unknown>(opts: UseMapPostingsOptions): UseMapPostingsResult<T> {
  const { mode, bounds, debounceMs = 0 } = opts;
  const category = opts.category ? opts.category : null;

  const modelRef = useRef<MapRequestModel<T> | null>(null);
  if (modelRef.current === null) modelRef.current = createMapRequestModel<T>();
  const model = modelRef.current;

  const [state, setState] = useState<MapRequestState<T>>(() => model.getState());
  const [retryNonce, setRetryNonce] = useState(0);
  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);

  // Primitive key so a new but equal bounds object does not refetch.
  const request = bounds ? buildMapRequest({ bounds, category, mode }) : null;
  const requestKey = request ? request.key : null;

  useEffect(() => {
    // Responses for the previous category are dropped from this point on,
    // even while the debounce timer is still pending.
    model.setDesiredCategory(category);
  }, [model, category]);

  useEffect(() => {
    if (requestKey === null) return;
    const req = buildMapRequestFromKey(requestKey, category);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = () => {
      const controller = new AbortController();
      const seq = model.begin(req, () => controller.abort());
      setState(model.getState());
      fetch(req.url, { signal: controller.signal })
        .then(async (res) => {
          const body = (await res.json().catch(() => null)) as
            | (Partial<MapResult<T>> & { error?: string })
            | null;
          if (!res.ok || !body || !Array.isArray(body.items)) {
            throw new Error(body?.error || FALLBACK_ERROR);
          }
          return { items: body.items, truncated: body.truncated === true } as MapResult<T>;
        })
        .then(
          (result) => {
            if (model.succeed(seq, req.category, result)) setState(model.getState());
          },
          (err: unknown) => {
            if (model.fail(seq, req.category, err)) setState(model.getState());
          },
        );
    };

    if (debounceMs > 0) timer = setTimeout(run, debounceMs);
    else run();

    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [model, requestKey, category, debounceMs, retryNonce]);

  useEffect(() => () => model.cancel(), [model]);

  return { ...state, retry };
}

function buildMapRequestFromKey(key: string, category: string | null) {
  return { url: `/api/postings/map?${key}`, category, key };
}
