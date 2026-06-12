import https from "https";

const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4bmtodHV4dHFmY3dnZnNlc3B3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNTkzMjgsImV4cCI6MjA5NjgzNTMyOH0.-MEbuklEnRpa6Ex5NZOAw2rCNoOeSyqVtl3PKir7F64";
const BASE = "pxnkhtuxtqfcwgfsespw.supabase.co";

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = https.request(
      {
        hostname: BASE,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          apikey: KEY,
          Authorization: `Bearer ${KEY}`,
          Prefer: "return=minimal",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, body: d }));
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const res = await request("GET", "/rest/v1/bolao_public_state?id=eq.copa-2026&select=data");
const data = JSON.parse(res.body)[0].data;

const ADMIN_USER_ID = "user-mqaxblsb-754696";
const ADMIN_PARTICIPANT_ID = "participant-mqaxblsb-i55qvp";

const adminUser = data.users.find(u => u.id === ADMIN_USER_ID);
const adminParticipant = data.participants.find(p => p.id === ADMIN_PARTICIPANT_ID);

const cleaned = {
  users: [{ ...adminUser, role: "admin" }],
  participants: [adminParticipant],
  predictions: {
    [ADMIN_PARTICIPANT_ID]: data.predictions?.[ADMIN_PARTICIPANT_ID] ?? {}
  },
  matches: data.matches,
  lastResultSyncAt: data.lastResultSyncAt
};

console.log("State after reset:");
console.log("  Users:", cleaned.users.map(u => `${u.name} <${u.email}> role=${u.role}`).join(", "));
console.log("  Participants:", cleaned.participants.map(p => p.name).join(", "));
console.log("  Predictions kept for:", Object.keys(cleaned.predictions).join(", ") || "(none)");
console.log("  Matches:", cleaned.matches?.length ?? 0);

const patch = await request("PATCH", "/rest/v1/bolao_public_state?id=eq.copa-2026", {
  data: cleaned,
  updated_at: new Date().toISOString()
});

console.log("HTTP", patch.status, patch.body || "→ Reset successful.");
