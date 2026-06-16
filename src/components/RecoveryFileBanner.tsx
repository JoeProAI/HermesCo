"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

export function RecoveryFileBanner() {
  const { user, userData } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [done, setDone] = useState(false);

  // Only show if keys exist but recovery file not yet downloaded
  if (!user || !userData || userData.recoveryFileDownloaded || done) return null;

  const download = async () => {
    if (!user) return;
    setDownloading(true);
    try {
      const token = await user.getIdToken();
      const res   = await fetch("/api/agent/keys/recovery", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { setDownloading(false); return; }

      const data     = await res.json();
      const blob     = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement("a");
      a.href         = url;
      a.download     = `clawd-recovery-${data.keyFingerprint}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDone(true);
    } catch {
      // silent
    }
    setDownloading(false);
  };

  return (
    <div className="dash-recovery-banner">
      <div className="dash-recovery-content">
        <div className="dash-recovery-dot" />
        <div>
          <p className="dash-recovery-title">Download your recovery file</p>
          <p className="dash-recovery-desc">
            Your agent keys are encrypted and stored on this platform. Download your recovery file now
            to restore your agent anywhere, even if clawd.run is unavailable. Store it offline like a seed phrase.
          </p>
        </div>
      </div>
      <button onClick={download} disabled={downloading} className="dash-recovery-btn">
        {downloading ? "Downloading..." : "Download recovery file"}
      </button>
    </div>
  );
}
