"use client";
import { useState } from "react";
import { avatarInitial, avatarUrl } from "@/lib/avatars/url";

/**
 * The one avatar used everywhere a user appears. Shows the stored photo when
 * there is one; otherwise, or if the image fails to load, a white circle with a
 * navy border and the username's first letter (design-tokens: signed-in profile
 * icon style). Fixed size, so a slow or missing image never shifts the layout.
 * The username is the only name it ever shows.
 */
export function Avatar({
  username,
  path,
  size = 28,
  className = "",
}: {
  username: string;
  path: string | null | undefined;
  /** Diameter in px. */
  size?: number;
  className?: string;
}) {
  const url = avatarUrl(path);
  // Remember WHICH url failed, so a new photo gets a fresh attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const label = `Profile photo of @${username}`;
  const box = { width: size, height: size };

  if (url && failedUrl !== url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- public Storage URL; already 512px WebP, no optimizer needed
      <img
        src={url}
        alt={label}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailedUrl(url)}
        style={box}
        className={`inline-block shrink-0 rounded-full border-2 border-deep-navy bg-white object-cover ${className}`}
        data-avatar="photo"
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={label}
      style={{ ...box, fontSize: Math.max(11, Math.round(size * 0.45)) }}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full border-2 border-deep-navy bg-white font-bold leading-none text-deep-navy ${className}`}
      data-avatar="fallback"
    >
      {avatarInitial(username)}
    </span>
  );
}