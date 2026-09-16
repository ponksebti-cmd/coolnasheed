import { useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../ui/Icons";
import { Avatar } from "../art/CoverArt";
import { useAccount } from "../../lib/hooks";

/**
 * The thumb bar.
 *
 * Below `lg` the sidebar is a drawer, which means everything behind it is two taps
 * away. These five are the ones people actually want one tap away. It sits under the
 * player bar as a flex sibling rather than floating over content, so nothing is ever
 * hidden behind it, and it clears the home indicator on notched phones.
 *
 * The selection is one lens that travels between slots rather than five highlights
 * that switch on and off, because movement is what tells you where you just came
 * from. Its geometry is measured off the real slot — the widths are fluid, and the
 * label can wrap at 320px — so the lens is always exactly where the finger expects.
 */

const SLOTS = ["/", "/search", "/studio", "/library", "/me"] as const;

export function MobileTabBar() {
  const account = useAccount();
  const { pathname } = useLocation();
  const listRef = useRef<HTMLUListElement>(null);
  const [lens, setLens] = useState<{ x: number; w: number } | null>(null);

  /* Every slot is a slot: Publish is a place you go, not a badge floating over the bar,
     so it takes the same lens as the other four. */
  const found =
    SLOTS.find((to) =>
      to === "/"
        ? pathname === "/"
        : pathname === to || pathname.startsWith(`${to}/`),
    ) ?? null;
  const activeTo = found;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !activeTo) {
      setLens(null);
      return;
    }
    const measure = () => {
      const slot = list.querySelector<HTMLElement>(`[data-slot="${activeTo}"]`);
      if (!slot) {
        setLens(null);
        return;
      }
      setLens({ x: slot.offsetLeft, w: slot.offsetWidth });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeTo]);

  return (
    <nav
      className="glass-bar safe-bottom relative z-40 border-t border-line lg:hidden"
      aria-label="Quick navigation"
    >
      <ul ref={listRef} className="relative flex items-stretch">
        {lens ? (
          <span
            className="tab-lens"
            style={{
              transform: `translateX(${lens.x + 8}px)`,
              width: Math.max(0, lens.w - 16),
            }}
            aria-hidden
          />
        ) : null}

        <li className="flex-1" data-slot="/">
          <Tab to="/" icon="home" label="Home" end />
        </li>
        <li className="flex-1" data-slot="/search">
          <Tab to="/search" icon="search" label="Search" />
        </li>
        <li className="flex-1" data-slot="/studio">
          <Tab to="/studio" icon="mic" label="Publish" />
        </li>
        <li className="flex-1" data-slot="/library">
          <Tab to="/library" icon="library" label="Library" />
        </li>
        <li className="flex-1" data-slot="/me">
          {account ? (
            <NavLink
              to="/me"
              className={({ isActive }) =>
                clsx(
                  "pressable flex min-h-[56px] w-full flex-col items-center justify-center gap-1 pt-1",
                  isActive ? "text-jade" : "text-muted",
                )
              }
              aria-label="Your profile"
            >
              <span className="grid h-6 w-6 place-items-center overflow-hidden rounded-full ring-1 ring-line2">
                <Avatar name={account.name} accent="jade" size={24} picture={account.avatarPath} />
              </span>
              <span className="text-[9.5px] font-bold uppercase tracking-[0.12em]">
                You
              </span>
            </NavLink>
          ) : (
            <Tab to="/me" icon="user" label="You" />
          )}
        </li>
      </ul>
    </nav>
  );
}

function Tab({
  to,
  icon,
  label,
  end,
}: {
  to: string;
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          "pressable relative flex min-h-[56px] w-full flex-col items-center justify-center gap-1",
          isActive ? "text-jade" : "text-muted active:text-text2",
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            name={icon}
            size={19}
            strokeWidth={isActive ? 2.2 : 1.8}
            className={clsx(isActive && "icon-pop")}
          />
          <span className="text-[9.5px] font-bold uppercase tracking-[0.12em]">
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}
