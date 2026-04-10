"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { GuildSummary } from "../lib/dashboardApi";

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

  return (
    <main className="min-h-screen bg-[#070b16] text-white">
      <div className="mx-auto flex min-h-screen max-w-[1800px]">
        <aside className="hidden w-[290px] border-r border-white/10 bg-[#08101f] px-5 py-6 lg:block">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-2xl shadow-lg shadow-indigo-900/40">
              🎮
            </div>

            <div>
              <p className="text-xl font-bold">StreetLife Bot</p>
              <p className="text-sm text-white/55">Multi-server dashboard</p>
            </div>
          </div>

          <div className="mb-6 rounded-3xl border border-white/10 bg-white/5 p-4">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-white/50">
              Selected Server
            </label>

            <select
              value={selectedGuildId}
              onChange={(event) => onGuildChange?.(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white outline-none"
            >
              {guilds.length === 0 && <option value="">No servers</option>}

              {guilds.map((guild) => (
                <option key={guild.id} value={guild.id} className="bg-[#111827]">
                  {guild.name}
                </option>
              ))}
            </select>

            <p className="mt-2 text-xs text-white/45">
              The dashboard remembers the last selected guild.
            </p>
          </div>

          <nav className="space-y-3">
            {navItems.map((item) => {
              const active = isActive(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                    active
                      ? "border-indigo-400/40 bg-white/10 shadow-lg shadow-black/20"
                      : "border-white/5 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="text-xs text-white/40">›</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <section className="flex-1 px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
          <header className="mb-6 rounded-3xl border border-white/10 bg-white/5 px-5 py-4 shadow-2xl shadow-black/20 backdrop-blur">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  {title}
                </h1>
                <p className="mt-1 text-sm text-white/60">{description}</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {badge}
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
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
