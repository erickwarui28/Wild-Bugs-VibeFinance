import { Component, type ReactNode } from "react";

export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section role="alert" className="m-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6"><h1 className="text-xl font-semibold">This page could not be displayed</h1><p className="my-3">Reload to recover. Your saved watchlist stays on this device.</p><button className="rounded-md bg-[var(--brand-fill)] px-3 py-2 text-white" onClick={() => window.location.reload()}>Reload application</button></section>;
    return this.props.children;
  }
}
