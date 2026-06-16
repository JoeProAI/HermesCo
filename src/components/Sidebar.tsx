"use client";

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: "◉" },
  { id: "agents", label: "Agents", icon: "◎" },
  { id: "runs", label: "Run History", icon: "◷" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  return (
    <aside className="nav-sidebar">
      <div className="nav-brand">
        <div className="nav-brand-icon">C</div>
        <div>
          <h1 className="nav-brand-text">clawd.run</h1>
          <p className="nav-brand-sub">Agent Management</p>
        </div>
      </div>

      <nav className="sidebar-nav-list">
        <ul className="sidebar-nav-items">
          {navItems.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => onViewChange(item.id)}
                className={`nav-item ${activeView === item.id ? "nav-item-active" : ""}`}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-upgrade-card">
          <p className="sidebar-upgrade-title">Personal Infrastructure</p>
          <p className="sidebar-upgrade-desc">Invite-based access controls are active</p>
        </div>

        <div className="sidebar-connect-card">
          <p className="sidebar-connect-title">Cloud Execution</p>
          <p className="sidebar-connect-desc">
            Isolated sandboxes for scalable agent execution
          </p>
          <button className="btn-outline-accent sidebar-connect-btn">
            Connect
          </button>
        </div>
      </div>
    </aside>
  );
}
