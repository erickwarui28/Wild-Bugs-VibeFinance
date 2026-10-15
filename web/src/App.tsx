import { HashRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { PageErrorBoundary } from "./components/PageErrorBoundary";
import { lazy, Suspense } from "react";
const Compare = lazy(() => import("./pages/Compare").then((m) => ({ default: m.Compare })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Docs = lazy(() => import("./pages/Docs").then((m) => ({ default: m.Docs })));
const Eval = lazy(() => import("./pages/Eval").then((m) => ({ default: m.Eval })));
const Trace = lazy(() => import("./pages/Trace").then((m) => ({ default: m.Trace })));
const Journal = lazy(() => import("./pages/Journal").then((m) => ({ default: m.Journal })));

export function App() {
  return (
    <PageErrorBoundary><HashRouter>
      <Suspense fallback={<p role="status" className="p-6">Loading page…</p>}><Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/trace" element={<Trace />} />
          <Route path="/trace/:runId" element={<Trace />} />
          <Route path="/eval" element={<Eval />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/docs/:docId" element={<Docs />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="*" element={<section className="rounded-xl border p-6"><h1>Page not found</h1><a href="#/">Return to dashboard</a></section>} />
        </Route>
      </Routes></Suspense>
    </HashRouter></PageErrorBoundary>
  );
}
