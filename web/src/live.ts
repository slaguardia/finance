// Live refresh: the backend emits `changed` on /api/events after every write
// (from this page, another device, or Claude working over the API). The current
// view re-renders off-screen and swaps in, so the page doesn't blank or jump —
// and it waits while the user is mid-edit.
let timer: number | undefined;

export function startLive(rerender: () => Promise<void>): void {
  const es = new EventSource("/api/events");
  const run = () => {
    const active = document.activeElement;
    if (active && active.matches("input, select, textarea")) { timer = window.setTimeout(run, 1000); return; }
    rerender().catch((e) => console.error("[live] refresh failed", e));
  };
  es.addEventListener("changed", () => {
    clearTimeout(timer);
    timer = window.setTimeout(run, 250);
  });
}
