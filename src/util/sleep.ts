// SPDX-License-Identifier: MIT
// Pons Family: small async helpers for Jay, the pons.family support agent.

/** Resolve after `ms` milliseconds, or early if `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
