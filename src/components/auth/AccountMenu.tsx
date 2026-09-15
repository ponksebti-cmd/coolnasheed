import { useNavigate } from "react-router-dom";
import { Icon } from "../ui/Icons";
import { DropdownMenu } from "../ui/Menu";
import { PatternArt } from "../art/PatternArt";
import { useToast } from "../ui/Primitives";
import { useAccount } from "../../lib/hooks";
import { useSession } from "../../store/session";
import { useUi } from "../../store/ui";
import { useStudio } from "../../store/studio";
import { useLibrary } from "../../store/library";

/**
 * The account corner of the top bar.
 *
 * Signed out it is a plain door — one tap to the sheet. Signed in it is your
 * generated avatar opening onto your profile, the studio, and your own writing.
 */
export function AccountMenu() {
  const account = useAccount();
  const navigate = useNavigate();
  const toast = useToast();
  const setAuth = useUi((s) => s.setAuth);
  const signOut = useSession((s) => s.signOut);
  const published = useStudio((s) => s.entries.length);
  const notes = useSession((s) => s.stats?.notes ?? 0);
  const playlists = useLibrary((s) => s.playlists.length);
  const staff = useSession((s) => s.user?.role === "staff");

  if (!account) {
    return (
      <button
        className="btn btn-ghost !px-2.5 !py-2 sm:!px-3.5"
        onClick={() => setAuth(true, "signin")}
        aria-label="Sign in or create an account"
        title="Sign in — listening needs nothing"
      >
        <Icon name="user" size={16} />
        <span className="hidden sm:inline">Sign in</span>
      </button>
    );
  }

  return (
    <DropdownMenu
      label="Your account"
      align="right"
      renderTrigger={({ onClick, open }) => (
        <button
          onClick={onClick}
          aria-expanded={open}
          aria-label={`Your account — @${account.handle}`}
          title={`@${account.handle}`}
          className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-line2 transition-shadow hover:ring-jade/50 no-hover:ring-jade/40"
        >
          <PatternArt seed={account.seed} showVignette={false} />
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-jade/80" aria-hidden />
        </button>
      )}
      items={[
        { label: "Your profile", icon: "user", onClick: () => navigate("/me") },
        { label: "Publish a nasheed", icon: "mic", onClick: () => navigate("/studio"), hint: "new" },
        {
          label: "Your nasheeds",
          icon: "waveform",
          onClick: () => navigate("/me?tab=nasheeds"),
          hint: published ? String(published) : undefined,
        },
        {
          label: "Your notes",
          icon: "lyrics",
          onClick: () => navigate("/me?tab=notes"),
          hint: notes ? String(notes) : undefined,
        },
        {
          label: "Your playlists",
          icon: "queue",
          onClick: () => navigate("/me?tab=playlists"),
          hint: playlists ? String(playlists) : undefined,
        },
        ...(staff
          ? [
              {
                label: "Staff room",
                icon: "shield" as const,
                onClick: () => navigate("/admin"),
                hint: "charts & moderation",
              },
            ]
          : []),
        {
          label: "Sign out",
          icon: "close",
          danger: true,
          onClick: () => {
            signOut();
            toast.push({ title: "Signed out", msg: "Your nasheeds and notes stay on this device.", kind: "info" });
          },
        },
      ]}
    />
  );
}
