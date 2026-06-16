import { Daytona } from "@daytonaio/sdk";
import { getAdminDb } from "@/lib/firebase-admin";

type DaytonaSandboxHandle = Awaited<ReturnType<Daytona["get"]>>;

function sandboxStateToInstanceStatus(state?: string): "running" | "stopped" {
  return state === "started" ? "running" : "stopped";
}

export function isSandboxReplacementError(error: unknown): boolean {
  const message = String(error || "").toLowerCase();
  return (
    message.includes("failed_precondition") ||
    message.includes("getting replaced") ||
    message.includes("refusing to start") ||
    message.includes("not found") ||
    message.includes("404")
  );
}

export async function resolveUserSandbox(
  daytona: Daytona,
  userId: string,
  knownSandboxId?: string | null,
): Promise<{
  sandbox: DaytonaSandboxHandle;
  sandboxId: string;
  replaced: boolean;
}> {
  if (knownSandboxId) {
    try {
      const sandbox = await daytona.get(knownSandboxId);
      return { sandbox, sandboxId: knownSandboxId, replaced: false };
    } catch (error) {
      if (!isSandboxReplacementError(error)) {
        throw error;
      }
    }
  }

  const result = await daytona.list(
    { "app-name": "openclaw", platform: "clawd.run", "user-id": userId },
    1,
    20,
  );

  const candidates = [...(result.items || [])].sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });

  const replacement = candidates.find((item) => item.id && item.id !== knownSandboxId) || candidates[0];
  if (!replacement?.id) {
    throw new Error(
      knownSandboxId
        ? `Sandbox ${knownSandboxId} is stale and no replacement was found for user ${userId}`
        : `No sandbox found for user ${userId}`,
    );
  }

  const sandbox = await daytona.get(replacement.id);

  if (replacement.id !== knownSandboxId) {
    const db = getAdminDb();
    await db.collection("clawdbot_instances").doc(userId).set(
      {
        sandboxId: replacement.id,
        status: sandboxStateToInstanceStatus(replacement.state),
        lastRecoveredSandboxId: replacement.id,
        lastRecoveredAt: new Date(),
        staleSandboxId: knownSandboxId || null,
        updatedAt: new Date(),
      },
      { merge: true },
    );
  }

  return {
    sandbox,
    sandboxId: replacement.id,
    replaced: replacement.id !== knownSandboxId,
  };
}
