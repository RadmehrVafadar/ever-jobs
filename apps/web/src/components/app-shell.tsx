import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Binoculars,
  ChartNoAxesCombined,
  GitCompareArrows,
  KeyRound,
  LayoutDashboard,
  Menu,
  Radar,
  Search,
  Settings,
  X,
} from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { OPERATOR_UI_MANIFEST } from "@ever-jobs/ui-operator/manifest";
import { api } from "../api/client";
import { useAuth } from "../context/auth-context";
import { StatusBadge } from "./ui";

const NAV_ICONS: Record<string, ReactNode> = {
  overview: <LayoutDashboard size={18} />,
  watches: <Radar size={18} />,
  notifications: <Bell size={18} />,
  matches: <Binoculars size={18} />,
  search: <Search size={18} />,
  compare: <GitCompareArrows size={18} />,
  settings: <Settings size={18} />,
};

const NAVIGATION = OPERATOR_UI_MANIFEST.navigation.map((item) => ({
  ...item,
  to: item.path,
  icon: NAV_ICONS[item.id],
  end: item.path === "/",
}));
const TITLES = Object.fromEntries(
  OPERATOR_UI_MANIFEST.navigation.map(({ path, label }) => [path, label]),
);

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const { hasApiKey } = useAuth();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => api.health(signal),
    refetchInterval: 30_000,
    retry: 1,
  });

  useEffect(() => setMenuOpen(false), [location.pathname]);
  const basePath = `/${location.pathname.split("/").filter(Boolean)[0] ?? ""}`;
  const title = location.pathname.startsWith("/watches/")
    ? "Watch editor"
    : (TITLES[basePath] ?? "Operator");

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside
        className={`sidebar ${menuOpen ? "sidebar--open" : ""}`}
        aria-label="Primary"
      >
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            <span />
          </span>
          <span>
            <strong>rad.ar</strong>
            <small>operator</small>
          </span>
        </div>
        <nav>
          <p className="sidebar__label">Workspace</p>
          {NAVIGATION.filter(({ id }) =>
            ["overview", "watches", "notifications", "matches"].includes(id),
          ).map((item) => (
            <NavigationLink key={item.to} {...item} />
          ))}
          <p className="sidebar__label sidebar__label--spaced">Explore</p>
          {NAVIGATION.filter(({ id }) =>
            ["search", "compare"].includes(id),
          ).map((item) => (
            <NavigationLink key={item.to} {...item} />
          ))}
        </nav>
        <div className="sidebar__footer">
          <NavigationLink
            {...NAVIGATION.find(({ id }) => id === "settings")!}
          />
          <div className="session-card">
            <span
              className={`session-card__icon ${hasApiKey ? "is-ready" : ""}`}
            >
              <KeyRound size={16} />
            </span>
            <span>
              <strong>
                {hasApiKey ? "Operator unlocked" : "Read-only session"}
              </strong>
              <small>
                {hasApiKey ? "Key stays in this tab" : "Add an API key"}
              </small>
            </span>
          </div>
          <p className="sidebar__local">Local only · 127.0.0.1</p>
        </div>
      </aside>
      {menuOpen ? (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
      <div className="workspace">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="topbar__title">
            <span>Operator</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar__status">
            <StatusBadge
              status={
                health.isError
                  ? "unavailable"
                  : (health.data?.status ??
                    (health.isPending ? "unknown" : "healthy"))
              }
              label={
                health.isPending
                  ? "Checking API"
                  : health.isError
                    ? "API offline"
                    : "API connected"
              }
            />
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function NavigationLink({
  to,
  label,
  icon,
  end,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `nav-link ${isActive ? "nav-link--active" : ""}`
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}
