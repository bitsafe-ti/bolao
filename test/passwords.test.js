import assert from "node:assert/strict";
import test from "node:test";
import { attachPasswordCredential, hasLegacyPassword, verifyPassword } from "../src/passwords.js";

test("hashes passwords and verifies only the correct secret", async () => {
  const user = await attachPasswordCredential({ id: "u1", email: "user@example.com" }, "senha-segura");

  assert.equal(user.password, undefined);
  assert.equal(typeof user.passwordHash, "string");
  assert.equal(typeof user.passwordSalt, "string");
  assert.equal(await verifyPassword(user, "senha-segura"), true);
  assert.equal(await verifyPassword(user, "senha-errada"), false);
});

test("supports legacy plaintext passwords for migration", async () => {
  const legacyUser = { id: "u1", password: "antiga" };

  assert.equal(hasLegacyPassword(legacyUser), true);
  assert.equal(await verifyPassword(legacyUser, "antiga"), true);
  assert.equal(await verifyPassword(legacyUser, "outra"), false);
});
