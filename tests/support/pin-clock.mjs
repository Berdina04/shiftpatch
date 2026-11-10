// Test-only clock: Date starts at SHIFTPATCH_TEST_NOW and then ticks normally.
// Loaded in every Vitest worker (vitest.config.ts) and, through NODE_OPTIONS,
// in the Next.js server Playwright starts (playwright.config.ts). App code is
// unchanged; it simply reads `new Date()`.
const target = Date.parse(process.env.SHIFTPATCH_TEST_NOW ?? "");
if (Number.isNaN(target)) {
  throw new Error("pin-clock: set SHIFTPATCH_TEST_NOW to an ISO timestamp");
}

const RealDate = globalThis.Date;
if (!RealDate.pinnedClock) {
  const offset = target - RealDate.now();
  const now = () => RealDate.now() + offset;
  globalThis.Date = new Proxy(RealDate, {
    construct: (Real, args, newTarget) => Reflect.construct(Real, args.length === 0 ? [now()] : args, newTarget),
    apply: () => new RealDate(now()).toString(),
    get: (Real, prop, receiver) => {
      if (prop === "now") return now;
      if (prop === "pinnedClock") return true;
      return Reflect.get(Real, prop, receiver);
    },
  });
}
