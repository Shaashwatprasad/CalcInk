export interface FrameMetrics {
  samples: number;
  p50Ms: number;
  p95Ms: number;
  overBudgetPercent: number;
  longTasks: number;
  longestTaskMs: number;
}
export function monitorFrames(
  onMetrics: (metrics: FrameMetrics) => void,
): () => void {
  const intervals: number[] = [];
  let previous = 0;
  let frame = 0;
  let disposed = false;
  let longTasks = 0;
  let longestTaskMs = 0;
  const visibilityChange = () => {
    previous = 0;
  };
  document.addEventListener('visibilitychange', visibilityChange);
  const observer =
    typeof PerformanceObserver === 'undefined'
      ? undefined
      : new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            longTasks++;
            longestTaskMs = Math.max(longestTaskMs, e.duration);
          }
        });
  try {
    observer?.observe({ type: 'longtask', buffered: true });
  } catch {
    /* Some browsers do not expose long tasks. */
  }
  const tick = (now: number) => {
    if (disposed) return;
    if (previous && document.visibilityState === 'visible') {
      intervals.push(now - previous);
      if (intervals.length > 600) intervals.shift();
    }
    previous = now;
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  const timer = setInterval(() => {
    const sorted = [...intervals].sort((a, b) => a - b);
    onMetrics({
      samples: sorted.length,
      p50Ms: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      overBudgetPercent: sorted.length
        ? (100 * sorted.filter((t) => t > 1000 / 60).length) / sorted.length
        : 0,
      longTasks,
      longestTaskMs,
    });
  }, 1000);
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    clearInterval(timer);
    observer?.disconnect();
    document.removeEventListener('visibilitychange', visibilityChange);
  };
}
