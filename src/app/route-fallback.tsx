import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useCopy } from "@/lib/copy";

export function RouteFallback() {
  const { tx } = useCopy();
  return <PageSkeleton label={tx("loading", "Loading…")} />;
}

type BoundaryProps = { children: ReactNode };
type BoundaryState = { failed: boolean };

export class RouteErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    import("@workspace/boosthis-runtime-web").then((kit) => kit.reportCaughtError(error), () => undefined);
  }

  render() {
    if (this.state.failed) return <RouteLoadError onRetry={() => window.location.reload()} />;
    return this.props.children;
  }
}

function RouteLoadError({ onRetry }: { onRetry: () => void }) {
  const { tx } = useCopy();
  return (
    <div role="alert" className="rounded-card border border-line bg-card p-4 shadow-card">
      <p className="text-sm text-ink">{tx("errorState", "Something went wrong. Try again.")}</p>
      <Button type="button" className="mt-3" onClick={onRetry}>
        {tx("retrySafeGet", "Retry")}
      </Button>
    </div>
  );
}
