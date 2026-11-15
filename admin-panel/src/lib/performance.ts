/**
 * Lite mode for slower computers (4 or fewer processor threads, or 4 GB of memory or less): no background blur behind
 * pop-ups (the heaviest effect for a weak graphics chip) and no animations, so every action shows at once.
 * Faster computers keep the effects. (Same file in the billing app.)
 */
export function applyPerformanceMode() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 8;
  const memory = nav.deviceMemory ?? 8;
  if (cores <= 4 || memory <= 4) document.documentElement.classList.add('lite');
}
