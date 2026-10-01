import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Auth } from "./components/Auth";
import "./index.css";
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Avoid logging evidence or credentials. */
  }
  render() {
    return this.state.failed ? (
      <main className="fatal-error">
        <h1>The workspace could not render.</h1>
        <p>Your server-side evidence and sessions are unchanged.</p>
        <button onClick={() => location.reload()}>Reload workspace</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    {location.pathname === "/login" ? (
      <Auth />
    ) : location.pathname === "/security" ? (
      <Auth security />
    ) : (
      <App />
    )}
  </ErrorBoundary>,
);
