const baseUrl = process.env.LOAD_TEST_URL;
const targetPath = process.env.LOAD_TEST_PATH ?? "/api/health";
const sessionCookie = process.env.LOAD_TEST_COOKIE;
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY ?? 20);
const requests = Number(process.env.LOAD_TEST_REQUESTS ?? 200);

if (!baseUrl) {
  throw new Error("Set LOAD_TEST_URL to an approved local or staging URL.");
}
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 100) {
  throw new Error("LOAD_TEST_CONCURRENCY must be an integer from 1 to 100.");
}
if (!Number.isSafeInteger(requests) || requests < 1 || requests > 10_000) {
  throw new Error("LOAD_TEST_REQUESTS must be an integer from 1 to 10000.");
}

const base = new URL(baseUrl);
const target = new URL(targetPath, base);
if (
  target.origin !== base.origin ||
  !targetPath.startsWith("/") ||
  target.username ||
  target.password ||
  target.hash
) {
  throw new Error("LOAD_TEST_PATH must be a same-origin absolute path without credentials or a fragment.");
}
const timings = [];
let cursor = 0;
let failures = 0;

async function worker() {
  while (cursor < requests) {
    cursor += 1;
    const startedAt = performance.now();
    try {
      const response = await fetch(target, {
        headers: sessionCookie ? { Cookie: sessionCookie } : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) failures += 1;
      await response.arrayBuffer();
    } catch {
      failures += 1;
    } finally {
      timings.push(performance.now() - startedAt);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

timings.sort((a, b) => a - b);
const percentile = (value) =>
  timings[Math.min(timings.length - 1, Math.floor(timings.length * value))];

const result = {
  target: target.origin,
  path: target.pathname,
  requests,
  concurrency,
  failures,
  p50Ms: Math.round(percentile(0.5)),
  p95Ms: Math.round(percentile(0.95)),
  p99Ms: Math.round(percentile(0.99)),
};

console.log(JSON.stringify(result, null, 2));
if (failures > 0) process.exitCode = 1;
