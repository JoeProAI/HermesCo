"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface UserMenuProps {
  onLoginClick: () => void;
}

export function UserMenu({ onLoginClick }: UserMenuProps) {
  const { user, userData, loading, signOut } = useAuth();
  const [showMenu, setShowMenu] = useState(false);

  if (loading) {
    return <div className="usermenu-skeleton" />;
  }

  if (!user) {
    return (
      <button onClick={onLoginClick} className="btn-primary btn-sm">Sign in</button>
    );
  }

  return (
    <div className="usermenu-wrap">
      <button onClick={() => setShowMenu(!showMenu)} className="usermenu-trigger">
        {user.photoURL ? (
          <img src={user.photoURL} alt={user.displayName || "User"} className="usermenu-avatar" />
        ) : (
          <div className="usermenu-avatar-fallback">
            {(user.displayName || user.email || "U")[0].toUpperCase()}
          </div>
        )}
        <div className="usermenu-info hidden-mobile">
          <p className="usermenu-name">{user.displayName || user.email?.split("@")[0]}</p>
          <p className="usermenu-credits">{userData?.credits || 0} credits</p>
        </div>
      </button>

      {showMenu && (
        <>
          <div className="usermenu-backdrop" onClick={() => setShowMenu(false)} />
          <div className="usermenu-dropdown">
            <div className="usermenu-header">
              <p className="usermenu-email">{user.email}</p>
              <p className="usermenu-plan">Infrastructure: <span className="text-accent">Personal</span></p>
            </div>

            <div className="usermenu-credits-bar">
              <div className="usermenu-credits-row">
                <span className="usermenu-credits-label">Credits</span>
                <span className="usermenu-credits-value">{userData?.credits || 0}</span>
              </div>
              <div className="usermenu-progress-track">
                <div className="usermenu-progress-fill" style={{ width: `${Math.min((userData?.credits || 0) / 100 * 100, 100)}%` }} />
              </div>
            </div>

            <button onClick={() => setShowMenu(false)} className="usermenu-item">Settings</button>

            <div className="usermenu-divider">
              <button onClick={() => { signOut(); setShowMenu(false); }} className="usermenu-item usermenu-item-danger">Sign out</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
