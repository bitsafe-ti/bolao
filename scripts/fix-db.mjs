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

const cleaned = {
  users: data.users
    .filter((u) => u.id !== "user-mqb0dx81-6d2sfw")
    .map((u) => (u.id === "user-mqaxblsb-754696" ? { ...u, role: "admin" } : u)),
  participants: data.participants.filter((p) => p.id !== "participant-mqb0dx81-qpjnn5"),
  predictions: data.predictions,
  matches: data.matches,
  lastResultSyncAt: data.lastResultSyncAt
};

console.log("Users after cleanup:");
cleaned.users.forEach((u) => console.log(" ", u.name, u.email, "role=" + u.role));
console.log("Participants:", cleaned.participants.map((p) => p.name).join(", "));

const patch = await request("PATCH", "/rest/v1/bolao_public_state?id=eq.copa-2026", {
  data: cleaned,
  updated_at: new Date().toISOString()
});

console.log("HTTP", patch.status, patch.body || "→ Saved successfully.");
