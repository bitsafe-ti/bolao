// Usage: node scripts/lock-match.mjs <matchId>
// Example: node scripts/lock-match.mjs group-d-1

const ENDPOINT      = "https://nyc.cloud.appwrite.io/v1";
const PROJECT_ID    = "6a2c61c200150745bf42";
const DATABASE_ID   = "bolao";
const COLLECTION_ID = "pool_state";
const DOCUMENT_ID   = "copa-2026";

const matchId = process.argv[2];
if (!matchId) { console.error("Usage: node scripts/lock-match.mjs <matchId>"); process.exit(1); }

const headers = { "X-Appwrite-Project": PROJECT_ID, "Content-Type": "application/json" };

const doc = await fetch(
  `${ENDPOINT}/databases/${DATABASE_ID}/collections/${COLLECTION_ID}/documents/${DOCUMENT_ID}`,
  { headers }
).then(r => r.json());

const data = JSON.parse(doc.data || "{}");
const match = (data.matches ?? []).find(m => m.id === matchId);
if (!match) { console.error(`Match "${matchId}" not found.`); process.exit(1); }

match.locked = true;
console.log(`Locking match: ${match.homeTeamId} x ${match.awayTeamId} (${match.date})`);

const res = await fetch(
  `${ENDPOINT}/databases/${DATABASE_ID}/collections/${COLLECTION_ID}/documents/${DOCUMENT_ID}`,
  { method: "PATCH", headers, body: JSON.stringify({ data: { data: JSON.stringify(data) } }) }
);
if (!res.ok) { console.error("PATCH failed:", await res.text()); process.exit(1); }
const result = await res.json();
console.log("Done. Updated at:", result.$updatedAt);
