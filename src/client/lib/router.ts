import { useEffect, useState } from "react";

/**
 * Three routes and no nested layouts, so a router dependency would be more
 * config than code. History API plus a popstate listener is the whole thing.
 */

export type Route =
  | { name: "landing" }
  | { name: "create" }
  | { name: "play"; quizId: string }
  | { name: "room"; code: string };

export function parseRoute(path: string): Route {
  const room = path.match(/^\/r\/(\d{4})\/?$/);
  if (room?.[1]) return { name: "room", code: room[1] };
  const play = path.match(/^\/q\/([A-Za-z0-9_-]+)\/?$/);
  if (play?.[1]) return { name: "play", quizId: play[1] };
  if (path === "/create") return { name: "create" };
  return { name: "landing" };
}

export function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);

  return route;
}
