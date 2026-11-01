import { NavyLink } from "./actions";

/**
 * Poster handle: a deep-navy @handle link to the poster profile. The username
 * is the only public name (account-model.md).
 */
export function PosterHandle({ username, className = "" }: { username: string; className?: string }) {
  return (
    <NavyLink href={`/u/${username}`} className={`font-bold ${className}`}>
      @{username}
    </NavyLink>
  );
}
