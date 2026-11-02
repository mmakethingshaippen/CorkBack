"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MapIcon, LayersIcon, ScanLineIcon, UsersIcon, BellIcon, MessageCircleIcon } from "@/components/icons";

/**
 * Bottom navigation: Map · Following · Scan · Messages · Friends · Alerts, with
 * Scan centered and raised (dark-red circle) as the anchor action. Messages
 * links a signed-in user to their inbox (the inbox page gates signed-out users).
 */
const items = [
  { href: "/", label: "Map", Icon: MapIcon },
  { href: "/following", label: "Following", Icon: LayersIcon },
  { href: "/scan", label: "Scan", Icon: ScanLineIcon, center: true },
  { href: "/inbox", label: "Messages", Icon: MessageCircleIcon },
  { href: "/friends", label: "Friends", Icon: UsersIcon },
  { href: "/alerts", label: "Alerts", Icon: BellIcon },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-board bg-paper">
      <ul className="mx-auto flex max-w-xl items-end justify-between px-4 py-2">
        {items.map(({ href, label, Icon, center }) => {
          const active = pathname === href;
          if (center) {
            return (
              <li key={href} className="-mt-6">
                <Link href={href} className="flex flex-col items-center gap-1">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-dark-red text-white shadow-md">
                    <Icon className="text-xl" />
                  </span>
                  <span className="text-xs text-ink">{label}</span>
                </Link>
              </li>
            );
          }
          return (
            <li key={href}>
              <Link
                href={href}
                className={`flex flex-col items-center gap-1 ${active ? "text-dark-red" : "text-ink/70"}`}
              >
                <Icon className="text-xl" />
                <span className="text-xs">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
