/**
 * Root error boundary for the side panel.
 *
 * Without this, ANY uncaught render error unmounts the whole tree and the
 * panel goes blank — no message, no stack, nothing to act on. A blank panel
 * is the least debuggable failure mode available, and it is what a user sees
 * for a one-line mistake three components deep.
 *
 * `ToolDisplayBoundary` already protects individual tool rows. This is the
 * outer net for everything else: chat, vault, settings, the tab shell itself.
 *
 * It deliberately shows the real error text. This panel is a developer-facing
 * surface on the user's own machine, and "something went wrong" would throw
 * away the only evidence of what actually happened.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { log } from '@/lib/debug/log';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

export class RootErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Goes through the debug relay so it reaches the SW console too — the
    // side panel's own console is easy to miss when the panel is blank.
    log.error('ui', `side panel render crashed: ${error.message}`, {
      stack: error.stack,
      componentStack: info.componentStack,
    });
    this.setState({ componentStack: info.componentStack ?? null });
  }

  private reset = () => {
    this.setState({ error: null, componentStack: null });
  };

  override render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 text-sm">
        <div>
          <p className="font-semibold text-destructive">The panel hit a render error</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The rest of the extension is still running. Reopening the panel usually clears it; the
            details below are what actually failed.
          </p>
        </div>

        <pre className="whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 text-xs">
          {error.message}
        </pre>

        {error.stack ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Stack</summary>
            <pre className="mt-1 whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2">
              {error.stack}
            </pre>
          </details>
        ) : null}

        {componentStack ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Component stack</summary>
            <pre className="mt-1 whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2">
              {componentStack}
            </pre>
          </details>
        ) : null}

        <button
          type="button"
          onClick={this.reset}
          className="self-start rounded border border-border px-3 py-1 text-xs hover:bg-accent"
        >
          Try again
        </button>
      </div>
    );
  }
}
