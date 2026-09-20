/**
 * Next.js instrumentation hook — runs once on every cold start.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrap } = await import("./lib/bootstrap");
    await bootstrap().catch((e: Error) => {
      // Never crash the server over a bootstrap failure
      console.error("[bootstrap] failed:", e.message);
    });
  }
}
