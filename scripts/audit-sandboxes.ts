import { getAdminDb } from "../src/lib/firebase-admin";

async function audit() {
  const db = getAdminDb();
  
  console.log("Fetching clawdbot instances...\n");
  const instancesSnapshot = await db.collection("clawdbot_instances").get();
  
  console.log(`Found ${instancesSnapshot.size} instances:\n`);
  console.log("=".repeat(100));
  
  for (const doc of instancesSnapshot.docs) {
    const instance = doc.data();
    const userId = doc.id;
    
    // Check subscription
    let hasBilling = false;
    let subTier = "none";
    try {
      const subSnapshot = await db.collection("subscriptions")
        .where("userId", "==", userId)
        .where("status", "in", ["active", "trialing"])
        .limit(1)
        .get();
      
      if (!subSnapshot.empty) {
        const sub = subSnapshot.docs[0].data();
        subTier = sub.tier || sub.plan || "pro";
        hasBilling = true;
      }
    } catch {}
    
    // Get user email
    let email = "unknown";
    try {
      const userDoc = await db.collection("users").doc(userId).get();
      if (userDoc.exists) {
        email = userDoc.data()?.email || "no-email";
      }
    } catch {}
    
    // Determine issue
    let issue = "";
    if (instance.type === "dedicated" && !hasBilling) {
      issue = "⚠️  NO BILLING - DEDICATED SANDBOX";
    } else if (instance.sandboxId && instance.status === "running" && !hasBilling) {
      issue = "⚠️  RUNNING WITHOUT BILLING";
    }
    
    console.log(`User: ${userId}`);
    console.log(`  Email: ${email}`);
    console.log(`  Sandbox: ${instance.sandboxId || "none"}`);
    console.log(`  Status: ${instance.status}`);
    console.log(`  Type: ${instance.type || "shared"}`);
    console.log(`  Tier (instance): ${instance.tier || "not set"}`);
    console.log(`  Subscription: ${hasBilling ? subTier : "NONE"}`);
    if (issue) console.log(`  ${issue}`);
    console.log("-".repeat(100));
  }
}

audit().then(() => process.exit(0)).catch(e => {
  console.error("Error:", e);
  process.exit(1);
});
