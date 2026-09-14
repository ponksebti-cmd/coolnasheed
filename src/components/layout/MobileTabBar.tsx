import { NavLink } from "react-router-dom";
import { clsx } from "clsx";
import { Icon } from "../ui/Icons";
import { PatternArt } from "../art/PatternArt";
import { useAccount } from "../../lib/hooks";
import { useStudio } from "../../store/studio";

/**
 * The thumb bar.
 *
 * Below `lg` the sidebar is a drawer, which means everything behind it is two taps
 * away. These five are the ones people actually want one tap away. It sits under the
 * player bar as a flex sibling rather than floating over content, so nothing is ever
 * hidden behind it, and it clears the home indicator on notched phones.
 */
export function MobileTabBar() {
  const account = useAccount();
  const published = useStudio((s) => s.entries.length);

  return (
    <nav
      className="safe-bottom z-40 border-t border-line bg-elev/94 backdrop-blur-2xl lg:hidden"
      aria-label="Quick navigation"
    >
      <ul className="flex items-stretch">
        <li className="flex-1">
          <Tab to="/" icon="home" label="Home" end />
        </li>
        <li className="flex-1">
          <Tab to="/search" icon="search" label="Search" />
        </li>
        <li className="flex-1">
          <NavLink
            to="/studio"
            className={({ isActive }) =>
              clsx(
                "group relative flex min-h-[56px] w-full flex-col items-center justify-center gap-1",
                isActive ? "text-gold" : "text-muted",
              )
            }
            aria-label="Publish a nasheed"
          >
            {({ isActive }) => (
              <>
                <span
                  className={clsx(
                    "grid h-11 w-11 -translate-y-2 place-items-center rounded-full shadow-[0_10px_26px_-10px_rgba(var(--c-glow-2),0.9)] transition-transform group-active:scale-95",
                    isActive
                      ? "bg-gradient-to-b from-goldsoft to-gold text-[#241a06]"
                      : "border border-line2 bg-surface2 text-goldsoft",
                  )}
                >
                  <Icon name="mic" size={19} />
                </span>
                <span className="absolute bottom-1.5 text-[9.5px] font-bold uppercase tracking-[0.12em]">
                  Publish
                </span>
                {published ? (
                  <span className="absolute right-1/2 top-1 translate-x-5 rounded-full bg-jade px-1.5 text-[9px] font-bold text-jadeink">
                    {published}
                  </span>
                ) : null}
              </>
            )}
          </NavLink>
        </li>
        <li className="flex-1">
          <Tab to="/library" icon="library" label="Library" />
        </li>
        <li className="flex-1">
          {account ? (
            <NavLink
              to="/me"
              className={({ isActive }) =>
                clsx(
                  "flex min-h-[56px] w-full flex-col items-center justify-center gap-1 pt-1",
                  isActive ? "text-jade" : "text-muted",
                )
              }
              aria-label="Your profile"
            >
              <span className="grid h-6 w-6 place-items-center overflow-hidden rounded-full ring-1 ring-line2">
                <PatternArt seed={account.seed} accent="jade" showVignette={false} />
              </span>
              <span className="text-[9.5px] font-bold uppercase tracking-[0.12em]">You</span>
            </NavLink>
          ) : (
            <Tab to="/me" icon="user" label="You" />
          )}
        </li>
      </ul>
    </nav>
  );
}

function Tab({ to, icon, label, end }: { to: string; icon: Parameters<typeof Icon>[0]["name"]; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        clsx(
          "relative flex min-h-[56px] w-full flex-col items-center justify-center gap-1 transition-colors",
          isActive ? "text-jade" : "text-muted active:text-text2",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <span className="absolute inset-x-5 top-0 h-[2px] rounded-full bg-jade" aria-hidden />
          ) : null}
          <Icon name={icon} size={19} strokeWidth={isActive ? 2.2 : 1.8} />
          <span className="text-[9.5px] font-bold uppercase tracking-[0.12em]">{label}</span>
        </>
      )}
    </NavLink>
  );
}
