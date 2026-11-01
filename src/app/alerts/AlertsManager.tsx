"use client";

import { useEffect, useState } from "react";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { CATEGORIES } from "@/lib/categories";

/**
 * Signed-in alerts manager: create an alert (one category, one home point, one
 * radius), list your alerts, delete an alert. No edit flow yet.
 *
 * Theme locked: fields are white with a 2px navy border, category chips as in
 * Stage 1, the create action is deep navy (secondary), delete is neutral.
 * The home point and radius are private and shown only here, to the owner.
 */

interface AlertRow {
  id: string;
  category_id: number | null;
  center_lat: number;
  center_lng: number;
  radius_miles: number | null;
  town_name: string | null;
  categories: { slug: string; label: string } | null;
}

export function AlertsManager() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  // Form state
  const [category, setCategory] = useState<string>("music");
  const [townName, setTownName] = useState("");
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [wholeTown, setWholeTown] = useState(false);
  const [radiusMiles, setRadiusMiles] = useState(5);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/alerts");
    const body = await res.json();
    if (res.ok) setAlerts(body.alerts ?? []);
    else setStatus(body.error ?? "Could not load alerts.");
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function useMyLocation() {
    if (!("geolocation" in navigator)) { setStatus("Location is not available in this browser."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setTownName(""); setStatus("Home point set to your current location."); },
      () => setStatus("Location permission is needed to set a map point."),
    );
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Creating…");
    const payload: Record<string, unknown> = {
      categorySlug: category,
      wholeTown,
      radiusMiles: wholeTown ? undefined : radiusMiles,
    };
    if (center) { payload.centerLat = center.lat; payload.centerLng = center.lng; }
    if (townName.trim()) payload.townName = townName.trim();

    const res = await fetch("/api/alerts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (res.ok) { setStatus("Alert created."); setTownName(""); setCenter(null); await load(); }
    else setStatus(body.error ?? "Could not create the alert.");
  }

  async function remove(id: string) {
    setStatus("Deleting…");
    const res = await fetch(`/api/alerts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const body = await res.json();
    if (res.ok) { setStatus("Alert deleted."); await load(); }
    else setStatus(body.error ?? "Could not delete the alert.");
  }

  return (
    <div className="space-y-6">
      {/* Create */}
      <form onSubmit={create} className="space-y-4 rounded-card border border-board bg-card p-4">
        <h2 className="text-lg font-bold text-ink">Create an alert</h2>

        <div>
          <p className="mb-2 text-sm font-bold text-ink">Category</p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <CategoryChip key={c.slug} label={c.label} selected={category === c.slug} onClick={() => setCategory(c.slug)} />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-bold text-ink">Home point</p>
          <label className="block">
            <input
              value={townName}
              onChange={(e) => { setTownName(e.target.value); setCenter(null); }}
              placeholder="Town name (e.g. London)"
              className="w-full rounded-[12px] border-2 border-deep-navy bg-white px-3 py-2 text-ink outline-none"
            />
          </label>
          <button type="button" onClick={useMyLocation} className="mt-2 rounded-control border border-deep-navy px-4 py-2 text-sm font-bold text-deep-navy">
            Or use a point on the map (current location)
          </button>
          {center ? <p className="mt-1 text-xs text-ink/60">Map point set. Your home point and radius stay private.</p> : null}
        </div>

        <div>
          <p className="mb-2 text-sm font-bold text-ink">Radius</p>
          <label className="mb-2 flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={wholeTown} onChange={(e) => setWholeTown(e.target.checked)} />
            Whole town
          </label>
          {!wholeTown ? (
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={25}
                value={radiusMiles}
                onChange={(e) => setRadiusMiles(Number(e.target.value))}
                className="flex-1"
                aria-label="Radius in miles"
              />
              <span className="w-20 text-sm font-bold text-ink">{radiusMiles} mi</span>
            </div>
          ) : null}
        </div>

        {/* Set an alert stays deep navy as a secondary action (locked theme). */}
        <button type="submit" className="w-full rounded-control bg-deep-navy px-5 py-3 font-bold text-white">
          Set an alert
        </button>
      </form>

      {/* List */}
      <div>
        <h2 className="mb-3 text-lg font-bold text-ink">Your alerts</h2>
        {loading ? (
          <p className="text-sm text-ink/60">Loading…</p>
        ) : alerts.length === 0 ? (
          <p className="text-sm text-ink/60">No alerts yet. Create one above to get an email when a matching posting appears.</p>
        ) : (
          <ul className="space-y-3">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-card border border-board bg-card p-3">
                <div>
                  <p className="font-bold text-ink">{a.categories?.label ?? "All categories"}</p>
                  <p className="text-sm text-ink/70">
                    {a.town_name ? `${a.town_name} · ` : "Map point · "}
                    {a.radius_miles == null ? "whole town" : `${a.radius_miles} mi`}
                  </p>
                </div>
                <button onClick={() => remove(a.id)} className="rounded-control border border-board px-4 py-2 text-sm font-bold text-ink">
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {status ? <p className="text-sm text-ink/70">{status}</p> : null}
    </div>
  );
}
