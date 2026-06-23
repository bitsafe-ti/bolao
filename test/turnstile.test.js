import test from "node:test";
import assert from "node:assert/strict";

import { TURNSTILE_VERIFY_URL, verifyTurnstileToken } from "../src/turnstile.js";

test("Turnstile exige token antes de consultar o Worker", async () => {
  let called = false;
  const result = await verifyTurnstileToken("", async () => {
    called = true;
  });

  assert.equal(result.success, false);
  assert.equal(called, false);
});

test("Turnstile libera o fluxo somente quando o Worker confirma success true", async () => {
  const result = await verifyTurnstileToken("valid-token", async (url, options) => {
    assert.equal(url, TURNSTILE_VERIFY_URL);
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { token: "valid-token" });
    return {
      ok: true,
      async json() {
        return { success: true };
      }
    };
  });

  assert.equal(result.success, true);
});

test("Turnstile bloqueia o fluxo quando o Worker rejeita o token", async () => {
  const result = await verifyTurnstileToken("invalid-token", async () => ({
    ok: true,
    async json() {
      return { success: false, "error-codes": ["invalid-input-response"] };
    }
  }));

  assert.equal(result.success, false);
  assert.match(result.message, /Tente novamente/);
});
