import { useEffect, useMemo, useState } from "react";
import { Icon } from "../ui/Icons";
import { Modal, useToast } from "../ui/Primitives";
import { Avatar } from "../art/CoverArt";
import { useUi } from "../../store/ui";
import { useSession, validateEmail, validateHandle, validateName, validatePassword } from "../../store/session";
import { hasSupabase } from "../../lib/supabase";

type Tab = "signin" | "signup";
type Errors = Partial<Record<"name" | "handle" | "email" | "password" | "identity" | "form", string>>;

const UNLOCKED: { icon: Parameters<typeof Icon>[0]["name"]; label: string }[] = [
  { icon: "star", label: "Love nasheeds and keep them in your library" },
  { icon: "plus", label: "Build playlists that survive a reload — and a new phone" },
  { icon: "lyrics", label: "Leave a note on a line, and amen someone else's" },
  { icon: "mic", label: "Publish your own nasheed — an mp3 you recorded, with the words" },
];

export function AuthModal() {
  const open = useUi((s) => s.authOpen);
  const requestedMode = useUi((s) => s.authMode);
  const intent = useUi((s) => s.authIntent);
  const setAuth = useUi((s) => s.setAuth);
  const busy = useSession((s) => s.busy);
  const signUp = useSession((s) => s.signUp);
  const signIn = useSession((s) => s.signIn);
  const toast = useToast();

  const [tab, setTab] = useState<Tab>(requestedMode);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [city, setCity] = useState("");
  const [reveal, setReveal] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  /** sign-up worked, but the project wants the email confirmed first */
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab(requestedMode);
    setErrors({});
    setPending(null);
    setPassword("");
    setReveal(false);
  }, [open, requestedMode]);

  /* the account you would become, drawn live from the handle you are typing */
  const previewName = useMemo(() => (name.trim() || handle.trim() || "you"), [name, handle]);
  const handleHint = useMemo(() => {
    const raw = handle.trim().toLowerCase().replace(/^@/, "");
    if (raw.length < 3) return null;
    return validateHandle(raw);
  }, [handle]);

  const finish = (who: string) => {
    toast.push({
      title: `Assalāmu ʿalaykum, ${who}`,
      msg: intent ? intent.label : "Your library, notes and nasheeds are yours now — on every device.",
      kind: "ok",
    });
    const run = intent?.run;
    setAuth(false);
    // run after the sheet closes so the state it touches is the signed-in one
    window.setTimeout(() => run?.(), 60);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    setPending(null);

    if (tab === "signup") {
      const nameErr = validateName(name);
      const handleErr = validateHandle(handle);
      const emailErr = validateEmail(email);
      const passErr = validatePassword(password);
      if (nameErr || handleErr || emailErr || passErr) {
        setErrors({
          name: nameErr ?? undefined,
          handle: handleErr ?? undefined,
          email: emailErr ?? undefined,
          password: passErr ?? undefined,
        });
        return;
      }
      const res = await signUp({ name, handle, password, email, city });
      if (!res.ok) {
        if (res.pending) {
          setPending(res.msg);
          setTab("signin");
          return;
        }
        setErrors({ [res.field]: res.msg } as Errors);
        return;
      }
      finish(res.account.name.split(" ")[0]!);
      return;
    }

    const emailErr = validateEmail(email);
    if (emailErr) {
      setErrors({ email: emailErr });
      return;
    }
    if (!password) {
      setErrors({ password: "Enter your password." });
      return;
    }

    const res = await signIn(email, password);
    if (!res.ok) {
      setErrors({ [res.field]: res.msg } as Errors);
      return;
    }
    finish(res.account.name.split(" ")[0]!);
  };

  const errorFor = (field: keyof Errors) => errors[field];

  return (
    <Modal
      open={open}
      onClose={() => setAuth(false)}
      align="bottom"
      title={tab === "signup" ? "Make an account" : "Welcome back"}
      subtitle={intent ? intent.label : "Listening and searching stay free. This is for the rest."}
    >
      <form onSubmit={submit} className="space-y-4 p-4 sm:p-5" noValidate>
        {pending ? (
          <p className="flex items-start gap-2 rounded-xl border border-jade/35 bg-jade/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-text2">
            <Icon name="check" size={14} className="mt-px shrink-0 text-jade" />
            {pending}
          </p>
        ) : null}

        {!hasSupabase ? (
          <p className="flex items-start gap-2 rounded-xl border border-gold/35 bg-gold/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-text2">
            <Icon name="info" size={14} className="mt-px shrink-0 text-gold" />
            <span>
              This build has no Supabase project, so accounts are switched off. Add{" "}
              <code className="rounded bg-surface2 px-1 py-0.5 text-[11.5px]">VITE_SUPABASE_URL</code> and{" "}
              <code className="rounded bg-surface2 px-1 py-0.5 text-[11.5px]">VITE_SUPABASE_ANON_KEY</code> to{" "}
              <code className="rounded bg-surface2 px-1 py-0.5 text-[11.5px]">.env</code> and reload — everything below
              will work. There is no catalogue to listen to until a project is connected:
              the catalogue is the database.
            </span>
          </p>
        ) : null}

        {tab === "signup" ? (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface2/40 p-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-line2">
              <Avatar name={previewName} accent="gold" size={48} />
            </span>
            <p className="text-[12.5px] leading-relaxed text-muted">
              Your name and handle are what people see. There is no photo to upload and nothing to moderate.
            </p>
          </div>
        ) : null}

        {tab === "signup" ? (
          <label className="block">
            <span className="field-label">Name</span>
            <input
              className="field"
              data-autofocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What should we call you?"
              autoComplete="nickname"
              autoCapitalize="words"
              maxLength={48}
              data-invalid={!!errorFor("name")}
              aria-invalid={!!errorFor("name")}
            />
            {errorFor("name") ? (
              <span className="field-error">
                <Icon name="info" size={12} /> {errorFor("name")}
              </span>
            ) : null}
          </label>
        ) : null}

        {tab === "signup" ? (
          <label className="block">
            <span className="field-label">Handle</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-muted">@</span>
              <input
                className="field pl-8 !text-[15px] lowercase"
                value={handle}
                onChange={(e) => setHandle(e.target.value.replace(/\s/g, ""))}
                placeholder="umm_kalthoum_fan"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                maxLength={24}
                data-invalid={!!errorFor("handle")}
                aria-invalid={!!errorFor("handle")}
              />
            </div>
            {errorFor("handle") ? (
              <span className="field-error">
                <Icon name="info" size={12} /> {errorFor("handle")}
              </span>
            ) : handleHint ? (
              <span className="field-error">
                <Icon name="info" size={12} /> {handleHint}
              </span>
            ) : handle.trim().length >= 3 ? (
              <span className="mt-1.5 flex items-center gap-1.5 text-[12px] text-jade">
                <Icon name="check" size={12} strokeWidth={3} /> @{handle.trim().toLowerCase().replace(/^@/, "")} — the
                database has the final say
              </span>
            ) : null}
          </label>
        ) : null}

        <label className="block">
          <span className="field-label">Email</span>
          <input
            className="field"
            type="email"
            data-autofocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            data-invalid={!!errorFor("email") || !!errorFor("identity")}
            aria-invalid={!!errorFor("email") || !!errorFor("identity")}
          />
          {errorFor("email") || errorFor("identity") ? (
            <span className="field-error">
              <Icon name="info" size={12} /> {errorFor("email") ?? errorFor("identity")}
            </span>
          ) : tab === "signin" ? (
            <span className="mt-1.5 block text-[11.5px] text-muted">
              Your handle is how people find you; your email is how you sign in.
            </span>
          ) : null}
        </label>

        <label className="block">
          <span className="field-label">Password</span>
          <div className="relative">
            <input
              className="field pr-12"
              type={reveal ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={tab === "signup" ? "At least eight characters" : "Your password"}
              autoComplete={tab === "signup" ? "new-password" : "current-password"}
              inputMode="text"
              data-invalid={!!errorFor("password")}
              aria-invalid={!!errorFor("password")}
            />
            <button
              type="button"
              className="btn-icon absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-2 text-muted"
              onClick={() => setReveal((v) => !v)}
              aria-label={reveal ? "Hide password" : "Show password"}
            >
              <Icon name={reveal ? "eyeOff" : "eye"} size={15} />
            </button>
          </div>
          {errorFor("password") ? (
            <span className="field-error">
              <Icon name="info" size={12} /> {errorFor("password")}
            </span>
          ) : null}
        </label>

        {tab === "signup" ? (
          <label className="block">
            <span className="field-label">
              City <span className="normal-case tracking-normal text-muted/70">(optional)</span>
            </span>
            <input
              className="field"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Algiers"
              autoComplete="address-level2"
              maxLength={40}
            />
          </label>
        ) : null}

        {errors.form ? (
          <p className="field-error rounded-lg border border-madder/35 bg-madder/10 px-3 py-2">
            <Icon name="info" size={12} /> {errors.form}
          </p>
        ) : null}

        <button type="submit" className="btn btn-primary w-full !py-3" disabled={busy || !hasSupabase}>
          {busy ? (
            <>
              <Icon name="waveform" size={15} className="animate-pulse" /> Working…
            </>
          ) : (
            <>
              <Icon name={tab === "signup" ? "sparkle" : "check"} size={15} />
              {tab === "signup" ? "Create the account" : "Sign in"}
            </>
          )}
        </button>

        <p className="rounded-xl border border-line bg-surface2/35 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
          <strong className="font-semibold text-text2">Supabase Auth holds the credentials, Postgres holds the rest.</strong>{" "}
          The password goes straight to Supabase over TLS and never touches this app's code or storage; what the browser
          keeps is a refresh token in localStorage. Your handle, notes, loves and sets are rows with your id on them, so
          they are waiting on the next device you sign in from. Do not reuse a password you use elsewhere.
        </p>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-3.5">
          <button
            type="button"
            className="btn px-2 py-1.5 !text-[12.5px] text-muted hover:text-text2"
            onClick={() => {
              setTab(tab === "signup" ? "signin" : "signup");
              setErrors({});
              setPending(null);
            }}
          >
            {tab === "signup" ? "Already have one? Sign in" : "New here? Make an account"}
          </button>
          <button type="button" className="btn px-2 py-1.5 !text-[12.5px] text-muted hover:text-text2" onClick={() => setAuth(false)}>
            Keep browsing
          </button>
        </div>
      </form>

      {tab === "signin" ? (
        <div className="border-t border-line bg-surface/40 px-4 py-3.5 sm:px-5">
          <div className="label mb-2">an account unlocks</div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {UNLOCKED.map((u) => (
              <li key={u.label} className="flex items-start gap-2 text-[12px] leading-snug text-muted">
                <Icon name={u.icon} size={13} className="mt-px shrink-0 text-jade" />
                {u.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Modal>
  );
}
