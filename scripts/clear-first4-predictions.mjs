// One-time script: remove predictions for the first 4 World Cup matches
// from all participants. Run with: node scripts/clear-first4-predictions.mjs

const ENDPOINT      = "https://nyc.cloud.appwrite.io/v1";
const PROJECT_ID    = "6a2c61c200150745bf42";
const DATABASE_ID   = "bolao";
const COLLECTION_ID = "pool_state";
const DOCUMENT_ID   = "copa-2026";

const MATCHES_TO_CLEAR = ["group-a-1", "group-a-2", "group-b-1", "group-d-1"];

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

// 2. Remove the 4 matches from every participant's predictions
let removed = 0;
for (const participantId of Object.keys(data.predictions ?? {})) {
  for (const matchId of MATCHES_TO_CLEAR) {
    if (data.predictions[participantId][matchId] !== undefined) {
      delete data.predictions[participantId][matchId];
      removed++;
    }
  }
}
console.log(`Removed ${removed} prediction entries across all participants.`);

// 3. Persist back
const patchRes = await fetch(
  `${ENDPOINT}/databases/${DATABASE_ID}/collections/${COLLECTION_ID}/documents/${DOCUMENT_ID}`,
  {
    method: "PATCH",
    headers,
    // Appwrite REST wraps document attributes under a nested "data" key
    body: JSON.stringify({ data: { data: JSON.stringify(data) } }),
  }
);
if (!patchRes.ok) {
  console.error("PATCH failed:", await patchRes.text());
  process.exit(1);
}
const result = await patchRes.json();
console.log("Done. Document updated at:", result.$updatedAt);
