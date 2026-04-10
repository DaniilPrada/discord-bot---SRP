"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getWriteToken, setWriteToken, type GuildSummary } from "../lib/dashboardApi";

type PanelLayoutProps = {
  title: string;
  description: string;
  children: ReactNode;
  guilds?: GuildSummary[];
  selectedGuildId?: string;
  onGuildChange?: (guildId: string) => void;
  badge?: ReactNode;
};

const navItems = [
  { label: "Dashboard", href: "/" },
  { label: "Server Settings", href: "/server-settings" },
  { label: "Commands", href: "/commands" },
  { label: "Auto Moderation", href: "/auto-moderation" },
  { label: "Logs", href: "/logs" },
  { label: "Users", href: "/users" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export default function PanelLayout({
  title,
  description,
  children,
  guilds = [],
  selectedGuildId = "",
  onGuildChange,
  badge,
}: PanelLayoutProps) {
  const pathname = usePathname();
  const [token, setToken] = useState("");
  const [showWriteAccess, setShowWriteAccess] = useState(false);

  useEffect(() => {
    setToken(getWriteToken());
  }, []);

  return (
    <main className="min-h-screen bg-[#050914] text-white">
      <div className="flex min-h-screen w-full pl-0">
        <aside className="hidden w-[276px] shrink-0 border-r border-white/8 bg-[#07101d] px-3 py-4 lg:block">
          <div className="mb-5 flex items-center gap-3 px-1">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-2xl shadow-lg shadow-indigo-900/30">
              🎮
            </div>
            <div>
              <p className="text-xl font-bold tracking-tight">StreetLife Bot</p>
              <p className="text-sm text-white/55">Multi-server dashboard</p>
            </div>
          </div>

          <div className="mb-4 border border-white/8 bg-white/[0.03] p-3">
            <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
              Selected Server
            </label>
            <select
              value={selectedGuildId}
              onChange={(event) => onGuildChange?.(event.target.value)}
              className="w-full border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none"
            >
              {guilds.length === 0 && <option value="">No servers</option>}
              {guilds.map((guild) => (
                <option key={guild.id} value={guild.id} className="bg-[#111827]">
                  {guild.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => setShowWriteAccess((current) => !current)}
            className="mb-4 flex w-full items-center justify-between border border-white/8 bg-white/[0.03] px-3 py-3 text-left text-sm"
          >
            <span>Write Access</span>
            <span className={`text-xs ${token ? "text-emerald-300" : "text-white/40"}`}>
              {token ? "saved" : "locked"}
            </span>
          </button>

          {showWriteAccess && (
            <div className="mb-4 border border-white/8 bg-black/10 p-3">
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Dashboard write token"
                className="w-full border border-white/10 bg-black/20 px-3 py-3 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => setWriteToken(token)}
                className="mt-2 w-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-3 text-sm font-medium text-emerald-200"
              >
                Save Token
              </button>
            </div>
          )}

          <nav className="space-y-2">
            {navItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex w-full items-center justify-between border px-4 py-3 text-left transition ${
                    active
                      ? "border-cyan-400/25 bg-white/10 shadow-lg shadow-black/20"
                      : "border-white/6 bg-white/[0.04] hover:bg-white/[0.08]"
                  }`}
                >
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="text-xs text-white/35">›</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <section className="min-w-0 flex-1 px-4 py-4 sm:px-5 lg:px-6">
          <header className="mb-5 border border-white/8 bg-white/[0.04] px-5 py-4 shadow-2xl shadow-black/20">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
                <p className="mt-1 text-sm text-white/60">{description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {badge}
                <div className="flex items-center gap-3 border border-white/8 bg-white/[0.04] px-3 py-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-slate-300 to-slate-500 text-sm font-bold text-black">
                    AX
                  </div>
                  <div className="hidden sm:block">
                    <p className="text-sm font-semibold">Alex</p>
                    <p className="text-xs text-white/50">Administrator</p>
                  </div>
                </div>
              </div>
            </div>
          </header>
          {children}
        </section>
      </div>
    </main>
  );
}
