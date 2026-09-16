/**
 * The screen that catches a crash.
 *
 * React unmounts the whole tree when a render throws, so without this a single bad
 * value — a missing field, an undefined index — leaves a blank page and no way back.
 * The boundary keeps the shell (tab bar, player, the rest of the app) alive and gives
 * the person three exits: try the screen again, go home, or reload.
 *
 * It is mounted twice on purpose: once around the whole app in `main.tsx`, and once
 * around the routed page in `AppShell`, so a broken page does not take the navigation
 * with it.
 *
 * Component stacks are not shown. They are for a developer, not for somebody who just
 * wanted to listen to a nasheed; the sentence says what happened and the buttons let
 * them out.
 */

import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { Icon } from "../ui/Icons";

type Props = {
  children: ReactNode;
  /** what was being drawn, for the log line and the sentence */
  label?: string;
  /** the shell wraps this in a padded frame; a full page (the root boundary) does not */
  bare?: boolean;
};

type State = {
  error: Error | null;
  /** bumped by "try again" to remount the subtree rather than re-render the same state */
  attempt: number;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    /* One line, in the console the developer already has open. Analytics are for
       listens; a crash report is not worth a request from a page that just fell over. */
    console.warn(
      `CoolNasheed: ${this.props.label ?? "the app"} could not be drawn.`,
      error,
      info.componentStack,
    );
  }

  private retry = (): void => {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      /* keyed by attempt so "try again" gives the subtree a fresh mount */
      return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
    }

    const where = this.props.label ? ` in ${this.props.label}` : "";
    const frame = this.props.bare
      ? "min-h-[60vh]"
      : "mx-auto flex min-h-[50vh] max-w-2xl items-center px-4 py-12";

    return (
      <div className={frame}>
        <div className="w-full rounded-2xl border border-line2 bg-surface/60 px-6 py-10 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-line2 bg-surface2 text-gold">
            <Icon name="shield" size={20} />
          </span>
          <h1 className="mt-4 text-xl text-text">
            That screen could not be drawn
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            Something broke{where}. Nothing you wrote was lost — try the screen
            again, or reload if it stays broken.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <button type="button" className="btn btn-primary" onClick={this.retry}>
              Try again
            </button>
            <a className="btn btn-ghost" href="/">
              Go home
            </a>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>

          <details className="mx-auto mt-6 max-w-md text-left">
            <summary className="cursor-pointer text-[11.5px] font-semibold uppercase tracking-[0.12em] text-muted">
              What went wrong
            </summary>
            <p className="mt-2 rounded-lg border border-line bg-bg/60 px-3 py-2 font-mono text-[11.5px] leading-relaxed text-text2">
              {error.message || String(error)}
            </p>
          </details>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
