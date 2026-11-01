import { NavyLink } from "./actions";

/**
 * The no-account affordance. Shown to visitors in place of active controls.
 * Public browsing has no account wall; posting/replying/liking/plans/alerts
 * require sign-in (account-model.md).
 */
export function SignInToTakePart({
  action = "take part",
}: {
  action?: string;
}) {
  return (
    <div className="rounded-card border border-board bg-board/40 p-4 text-sm">
      <p className="font-bold text-ink">Sign in to {action}</p>
      <p className="mt-1 text-ink/70">
        A free account is required to post, reply, like, set plans, and set alerts.{" "}
        <NavyLink href="/sign-in">Sign in</NavyLink> or{" "}
        <NavyLink href="/sign-up">create one</NavyLink>.
      </p>
    </div>
  );
}
