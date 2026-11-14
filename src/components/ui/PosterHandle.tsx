import { NavyLink } from "./actions";
import { Avatar } from "./Avatar";

/**
 * Poster handle: a deep-navy @handle link to the poster profile. The username
 * is the only public name (account-model.md). Pass `avatarPath` (null is fine:
 * it shows the fallback) to put the user's avatar beside the handle; omit it
 * and the output is exactly the plain handle.
 */
export function PosterHandle({
  username,
  className = "",
  avatarPath,
  avatarSize = 24,
}: {
  username: string;
  className?: string;
  avatarPath?: string | null;
  avatarSize?: number;
}) {
  const link = (
    <NavyLink href={`/u/${username}`} className={`font-bold ${className}`}>
      @{username}
    </NavyLink>
  );
  if (avatarPath === undefined) return link;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-2 align-middle">
      <Avatar username={username} path={avatarPath} size={avatarSize} />
      <span className="min-w-0 break-words">{link}</span>
    </span>
  );
}