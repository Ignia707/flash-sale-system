// Waiting times that grow after each failure, with random jitter so thousands of browsers don't retry in step.

export function backoffDelay(
  attempt: number, // 0 for the first retry
  { baseMs = 500, factor = 1.6, maxMs = 5000, random = Math.random } = {},
): number {
  const ceiling = Math.min(maxMs, baseMs * factor ** attempt);
  return Math.round(ceiling / 2 + (random() * ceiling) / 2); // between half and the full ceiling
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
