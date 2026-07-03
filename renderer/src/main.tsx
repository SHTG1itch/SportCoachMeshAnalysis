import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Electron's default for a file dropped anywhere on the window is to NAVIGATE
// to it, replacing the app. The two MediaDrop zones preventDefault locally;
// these window-level guards cover everywhere else (sidebar, top bar, result
// screens). The main process additionally blocks the navigation itself.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort error boundary. Without one, a single render-time TypeError
 * (e.g. one malformed persisted record reaching a screen) white-screens the
 * whole app with no way back. Renders a minimal recovery surface instead —
 * deliberately plain DOM/inline styles so it cannot depend on anything that
 * might itself be broken.
 */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          background: "#0b0d12",
          color: "#e6e9f0",
          fontFamily: "system-ui, sans-serif",
          padding: 32,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</div>
        <div style={{ fontSize: 13, color: "#9aa3b5", maxWidth: 480 }}>
          {this.state.error.message}
        </div>
        <button
          onClick={() => {
            this.setState({ error: null });
            window.location.reload();
          }}
          style={{
            marginTop: 8,
            padding: "8px 16px",
            borderRadius: 8,
            border: "1px solid #2a3040",
            background: "#161a24",
            color: "#e6e9f0",
            cursor: "pointer",
          }}
        >
          Reload app
        </button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);
