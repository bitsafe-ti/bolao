import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost } from "../functions/api/prizes/payouts.js";

class FakeD1 {
  constructor(state = null) {
    this.row = state
      ? {
          data: JSON.stringify(state),
          updated_at: "2026-07-15T10:00:00.000Z"
        }
      : null;
  }

  prepare(sql) {
    return new FakeD1Statement(this, sql);
  }
}

class FakeD1Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (/select data, updated_at from pool_state/i.test(this.sql)) {
      return this.db.row;
    }
    return null;
  }

  async run() {
    if (/create table if not exists pool_state/i.test(this.sql)) {
      return { meta: { changes: 0 } };
    }

    if (/insert into pool_state/i.test(this.sql)) {
      const [, data, , updatedAt, expectedVersion] = this.values;
      if (!this.db.row || this.db.row.updated_at === expectedVersion) {
        this.db.row = { data, updated_at: updatedAt };
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }

    return { meta: { changes: 0 } };
  }
}

test("prize payout save preserves protected CPF and Pix on later partial updates", async () => {
  const db = new FakeD1({
    users: [],
    participants: [{ id: "p1", name: "Ana", prizePayoutStatus: { hasData: true, updatedAt: "2026-07-14T12:00:00.000Z" } }],
    prizePayouts: {
      p1: {
        participantId: "p1",
        holderName: "Ana",
        holderDocument: "12345678901",
        pixKeyType: "email",
        pixKey: "ana@example.com",
        bankName: "Banco Antigo",
        notes: "Observacao antiga",
        updatedAt: "2026-07-14T12:00:00.000Z"
      }
    },
    auditLogs: []
  });

  const response = await onRequestPost({
    env: { DB: db },
    request: new Request("https://example.com/api/prizes/payouts", {
      method: "POST",
      body: JSON.stringify({
        poolId: "pool-test",
        participantId: "p1",
        payout: {
          holderName: "Ana Maria",
          holderDocument: "",
          pixKeyType: "cpf",
          pixKey: "",
          bankName: "Banco Novo",
          notes: ""
        }
      })
    })
  });

  assert.equal(response.status, 200);

  const savedState = JSON.parse(db.row.data);
  assert.equal(savedState.prizePayouts.p1.holderName, "Ana Maria");
  assert.equal(savedState.prizePayouts.p1.holderDocument, "12345678901");
  assert.equal(savedState.prizePayouts.p1.pixKeyType, "email");
  assert.equal(savedState.prizePayouts.p1.pixKey, "ana@example.com");
  assert.equal(savedState.prizePayouts.p1.bankName, "Banco Novo");
  assert.equal(savedState.prizePayouts.p1.notes, "");

  const payload = await response.json();
  assert.equal(payload.saved, true);
  assert.equal(payload.state.prizePayouts, undefined);
});

test("prize payout save still requires CPF and Pix on first submission", async () => {
  const db = new FakeD1({
    users: [],
    participants: [{ id: "p1", name: "Ana" }],
    prizePayouts: {},
    auditLogs: []
  });

  const response = await onRequestPost({
    env: { DB: db },
    request: new Request("https://example.com/api/prizes/payouts", {
      method: "POST",
      body: JSON.stringify({
        poolId: "pool-test",
        participantId: "p1",
        payout: {
          holderName: "Ana",
          holderDocument: "",
          pixKeyType: "cpf",
          pixKey: ""
        }
      })
    })
  });

  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error, "Informe CPF ou CNPJ valido do titular.");
});
