import { Daytona } from "@daytonaio/sdk";

const SOURCE_ID = "8d13222b-da04-4f2b-b5eb-9d799f931349";  // Old sandbox with good data (8d)
const TARGET_ID = "3abd6524-375a-4c87-89e5-a843f8db3f35";  // Current sandbox (3abd)

async function transferData() {
  const daytona = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
    target: "us",
  });

  console.log(`Transferring data from ${SOURCE_ID} to ${TARGET_ID}...`);

  const source = await daytona.get(SOURCE_ID);
  const target = await daytona.get(TARGET_ID);

  // Start source sandbox
  console.log("Starting source sandbox...");
  try {
    await source.start();
    await new Promise(r => setTimeout(r, 5000));
  } catch (e) {
    console.log("Source already running or error:", e);
  }

  // Find files in source
  const findResult = await source.process.executeCommand(`
    find /home/node -maxdepth 5 -type f \\( -name "*.md" -o -name "*.json" -o -name "*.txt" \\) 2>/dev/null | grep -v node_modules | grep -v .npm | head -100
  `);
  
  const files = (findResult.result || "").split("\n").filter(f => f.trim() && !f.includes("node_modules"));
  console.log(`Found ${files.length} files to transfer`);

  let transferred = 0;
  for (const filePath of files) {
    if (!filePath.trim()) continue;
    try {
      const content = await source.fs.downloadFile(filePath);
      if (content && content.length > 0) {
        // Create directory on target
        const dir = filePath.substring(0, filePath.lastIndexOf("/"));
        await target.process.executeCommand(`mkdir -p ${dir}`);
        await target.fs.uploadFile(content, filePath);
        console.log(`✓ ${filePath} (${content.length} bytes)`);
        transferred++;
      }
    } catch (e) {
      console.log(`✗ ${filePath}: ${e}`);
    }
  }

  console.log(`\nTransfer complete: ${transferred} files`);
}

transferData().catch(console.error);
