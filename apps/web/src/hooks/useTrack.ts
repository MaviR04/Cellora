import { useEffect } from "react";
import { useLocation } from "react-router";
import { track, type EventType, type PropsOf } from "../lib/tracker";

// Last key tracked per event type. React StrictMode runs effects twice in development, and a
// re-render must not produce a second "view" event, so identical keys are skipped.
const lastKey = new Map<string, string>();

/**
 * Track a "view"-style event once per navigation (location.key) and per `dependency`.
 * `props` is null until the data needed for the event has loaded.
 */
export function useTrackView<T extends EventType>(type: T, props: PropsOf<T> | null, dependency = "") {
  const location = useLocation();
  const key = `${location.key}|${dependency}`;
  useEffect(() => {
    if (!props || lastKey.get(type) === key) return;
    lastKey.set(type, key);
    track(type, props);
    // props is intentionally not a dependency: `dependency` says when it is a new view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, key, props === null]);
}
