import Link from "next/link";

/**
 * PrimaryAction: dark red, 50px radius. Exactly ONE per screen (design-tokens.md).
 * SecondaryAction: deep navy or neutral; use for everything else.
 */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: React.ReactNode;
};

export function PrimaryAction({ children, className = "", ...props }: BtnProps) {
  return (
    <button
      className={`rounded-control bg-dark-red px-5 py-3 font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function SecondaryAction({ children, className = "", ...props }: BtnProps) {
  return (
    <button
      className={`rounded-control bg-deep-navy px-5 py-3 font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function NeutralAction({ children, className = "", ...props }: BtnProps) {
  return (
    <button
      className={`rounded-control border border-board bg-board/60 px-5 py-3 font-bold text-ink transition-opacity hover:opacity-90 disabled:opacity-60 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/** Navy link role: View profile, View posting, @handles, desktop Map link. */
export function NavyLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} className={`text-deep-navy underline-offset-2 hover:underline ${className}`}>
      {children}
    </Link>
  );
}
