import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { useEffectsSettings } from "./lib/spotify";

/**
 * Failures that are a moment, not a verdict.
 *
 * Two of them. A `429` carries a `Retry-After` — a window of seconds — and a `503`
 * is Spotify's own edge saying it is busy; measured on this account, the second
 * one lasted twelve minutes once. Neither gets better by failing faster, and both
 * resolve without anybody doing anything, so both are retried.
 *
 * A `403` still fails on first contact: in development mode it is a correct
 * answer about one playlist, and retrying it three times turns that into a
 * fifteen-second wait for the same sentence.
 */
function retryable(error: unknown): "rate_limit" | "service" | null {
  // `invoke` rejects with the kebab-case string Rust returned, but a rejection is
  // not required to be a string: a transport failure, a thrown object, or a
  // deserialisation error all arrive here too. Calling `.includes` on one of those
  // throws inside the query layer and takes the whole app down with it.
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (text.includes("rate_limited")) return "rate_limit";
  if (text.includes("service_unavailable")) return "service";
  return null;
}

function retryPolicy(failureCount: number, error: unknown): boolean {
  const kind = retryable(error);
  if (!kind) return false;
  // A throttle has a stated deadline, so three tries is the whole story. An
  // outage has no deadline and once ran for twelve minutes, so this backs off
  // instead of giving up — four, eight, sixteen, thirty-two and sixty-four
  // seconds, which is two minutes of trying without ever nagging in a loop.
  return kind === "rate_limit" ? failureCount < 3 : failureCount < 5;
}

function retryDelay(attempt: number, error: unknown): number {
  return retryable(error) === "rate_limit" ? 15_000 : 4_000 * 2 ** attempt;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: retryPolicy,
      retryDelay,
      // Long enough to sit out the `Retry-After` Spotify sent, short enough that
      // nobody reads it as a hang.
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * "Animaciones de la interfaz" off is Motion's reduced motion, forced: springs,
 * entrances and press feedback jump to their end. "user" leaves it to the system.
 */
function Root() {
  const { motion } = useEffectsSettings();
  return (
    <MotionConfig reducedMotion={motion === "off" ? "always" : "user"}>
      <App />
    </MotionConfig>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </React.StrictMode>,
);
