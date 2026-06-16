"use client";

import { useState } from "react";

type Props = {
  userId: string;
  userEmail?: string;
};

type MintPackId = "starter" | "pro" | "ultra";

const PACKS: Array<{ id: MintPackId; name: string; mints: number; price: number; description: string }> = [
  { id: "starter", name: "Starter Mint Pack", mints: 50, price: 5, description: "50 Arweave soul saves" },
  { id: "pro", name: "Pro Mint Pack", mints: 200, price: 15, description: "200 Arweave soul saves" },
  { id: "ultra", name: "Ultra Mint Pack", mints: 1000, price: 50, description: "1,000 Arweave soul saves - best value" },
];

export default function MintPackCard({ userId, userEmail }: Props) {
  const [loadingPack, setLoadingPack] = useState<MintPackId | null>(null);

  const buyPack = async (mintPackId: MintPackId) => {
    try {
      setLoadingPack(mintPackId);
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mintPackId, userId, userEmail }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        alert(data.error || "Failed to create checkout session");
        return;
      }
      window.location.href = data.url;
    } catch {
      alert("Failed to start checkout");
    } finally {
      setLoadingPack(null);
    }
  };

  return (
    <div className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-100">
      <div className="mb-4">
        <h3 className="text-lg font-semibold">Mint Packs</h3>
        <p className="text-sm text-zinc-400">Buy extra mint credits anytime.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PACKS.map((pack) => {
          const isLoading = loadingPack === pack.id;
          return (
            <div key={pack.id} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
              <p className="text-sm uppercase tracking-wide text-zinc-400">{pack.name}</p>
              <p className="mt-2 text-3xl font-bold">${pack.price}</p>
              <p className="mt-1 text-sm text-zinc-400">{pack.description}</p>
              <p className="mt-3 text-sm text-zinc-300">{pack.mints} mints</p>
              <button
                type="button"
                onClick={() => buyPack(pack.id)}
                disabled={loadingPack !== null}
                className="mt-4 w-full rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? "Redirecting..." : `Buy for $${pack.price}`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
