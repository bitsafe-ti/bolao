import { syncPoolResults, readPoolStateForHealth } from "./sync.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/health") {
      return new Response("Not Found", { status: 404 });
    }
    const poolId = env.POOL_ID || "copa-2026";
    const snapshot = env.DB ? await readPoolStateForHealth(env.DB, poolId) : null;
    return Response.json({
      ok: true,
      service: "bolao-copa2026-results-sync",
      liveProviderConfigured: Boolean(env.API_FOOTBALL_KEY),
      lastResultSyncAt: snapshot?.lastResultSyncAt ?? null,
      lastResultSyncSource: snapshot?.lastResultSyncSource ?? null,
      lastApiFallbackReason: snapshot?.lastApiFallbackReason ?? null
    });
  },

  async scheduled(controller, env) {
    const startedAt = Date.now();
    try {
      const result = await syncPoolResults(env, controller.scheduledTime);
      console.log(JSON.stringify({
        message: "results sync completed",
        cron: controller.cron,
        durationMs: Date.now() - startedAt,
        ...result
      }));
    } catch (error) {
      console.error(JSON.stringify({
        message: "results sync failed",
        cron: controller.cron,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      }));
      throw error;
    }
  }
};
