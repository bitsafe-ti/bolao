// One-time script: tombstone predictions for the first 4 World Cup matches.
// Sets home/away to "" with a fresh updatedAt so the merge logic always
// prefers this cleared value over any stale localStorage cache.
// Run with: node scripts/clear-first4-predictions.mjs

const ENDPOINT      = "https://nyc.cloud.appwrite.io/v1";
const PROJECT_ID    = "6a2c61c200150745bf42";
const DATABASE_ID   = "bolao";
const COLLECTION_ID = "pool_state";
const DOCUMENT_ID   = "copa-2026";

const MATCHES_TO_CLEAR = ["group-a-1", "group-a-2", "group-b-1", "group-d-1"];
const NOW = new Date().toISOString();

const headers = {
  "X-Appwrite-Project": PROJECT_ID,
  "Content-Type": "application/json",
};

// 1. Fetch current document
const getRes = await fetch(
  `${ENDPOINT}/databases/${DATABASE_ID}/collections/${COLLECTION_ID}/documents/${DOCUMENT_ID}`,
  { headers }
);
if (!getRes.ok) {
  console.error("GET failed:", await getRes.text());
  process.exit(1);
}
const doc = await getRes.json();
const data = JSON.parse(doc.data || "{}");

// 2. Overwrite each match prediction with a tombstone {home:"",away:"",updatedAt:NOW}
//    so pickNewest always prefers this over older cached values.
//    Also ensure ALL participants have the tombstone, not just those who predicted.
const allParticipantIds = (data.participants ?? []).map(p => p.id);
let written = 0;
for (const participantId of allParticipantIds) {
  if (!data.predictions[participantId]) data.predictions[participantId] = {};
  for (const matchId of MATCHES_TO_CLEAR) {
    data.predictions[participantId][matchId] = { home: "", away: "", updatedAt: NOW, savedAt: NOW };
    written++;
  }
}
console.log(`Tombstoned ${written} prediction slots (${allParticipantIds.length} participants × ${MATCHES_TO_CLEAR.length} matches).`);

// 3. Persist back
const patchRes = await fetch(
  `${ENDPOINT}/databases/${DATABASE_ID}/collections/${COLLECTION_ID}/documents/${DOCUMENT_ID}`,
  {
    method: "PATCH",
    headers,
    body: JSON.stringify({ data: { data: JSON.stringify(data) } }),
  }
);
if (!patchRes.ok) {
  console.error("PATCH failed:", await patchRes.text());
  process.exit(1);
}
const result = await patchRes.json();
console.log("Done. Document updated at:", result.$updatedAt);
