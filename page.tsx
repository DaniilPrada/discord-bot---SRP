"use client";

import { useEffect, useMemo, useState } from "react";
import PanelLayout from "./components/PanelLayout";
import {
  fetchDashboard,
  updateModules,
  type DashboardPayload,
} from "./lib/dashboardApi";
import { useSelectedGuild } from "./lib/useSelectedGuild";

const defaultData: DashboardPayload = {
  ok: true,
  guild: {
    id: "",
    name: "No Server",
    memberCount: 0,
    iconUrl: null,
  },
  primaryServerName: "No Server",
  primaryServerMembers: 0,
  totalServers: 0,
  totalUsers: 0,
  activeCommands: 0,
  bannedUsers: 0,
  totalMessages: 0,
  botStatus: "offline",
  ping: 0,
  memoryMb: 0,
  cpuUsage: 0,
  modules: {
    welcomeMessages: true,
    autoModeration: true,
    musicModule: true,
    antiSpamFilter: false,
  },
  lastUpdate: null,
  recentActivity: [],
  moderationLogs: [],
  commandUsage: [],
};

function formatRelative(value: string | null) {
  if (!value) return "never";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "never";

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diffMs / 60000));

  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

export default function DashboardPage() {
  const { guilds, selectedGuildId, setSelectedGuildId } = useSelectedGuild();
  const [data, setData] = useState<DashboardPayload>(defaultData);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [savingModule, setSavingModule] = useState("");

  useEffect(() => {
    if (!selectedGuildId) return;

    let mounted = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function loadDashboard() {
      try {
        setLoading(true);
        const payload = await fetchDashboard(selectedGuildId);

        if (!mounted) return;
        setData(payload);
        setErrorText("");
      } catch (error) {
        console.error(error);
        if (mounted) {
          setErrorText(error instanceof Error ? error.message : "Failed to load dashboard.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadDashboard();
    intervalId = setInterval(loadDashboard, 10000);

    return () => {
      mounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [selectedGuildId]);

  const statCards = useMemo(
    () => [
      {
        title: "Selected Server Members",
        value: formatNumber(data.primaryServerMembers),
        icon: "👥",
      },
      {
        title: "Active Commands",
        value: formatNumber(data.activeCommands),
        icon: "💬",
      },
      {
        title: "Banned Users",
        value: formatNumber(data.bannedUsers),
        icon: "💀",
      },
      {
        title: "Total Messages",
        value: formatNumber(data.totalMessages),
        icon: "📨",
      },
      {
        title: "Servers Connected",
        value: formatNumber(data.totalServers),
        icon: "🗂️",
      },
    ],
    [data]
  );

  const topCommandUsage = useMemo(() => {
    const items =
      data.commandUsage.length > 0
        ? data.commandUsage.slice(0, 5)
        : [
            { name: "ping", label: "!ping", count: 0 },
            { name: "warn", label: "!warn", count: 0 },
            { name: "play", label: "!play", count: 0 },
            { name: "ban", label: "!ban", count: 0 },
          ];

    const maxValue = Math.max(...items.map((item) => item.count), 1);

    return items.map((item, index) => {
      const gradients = [
        "from-cyan-400 to-blue-500",
        "from-orange-400 to-red-500",
        "from-violet-400 to-purple-500",
        "from-yellow-300 to-amber-500",
        "from-emerald-400 to-lime-500",
      ];

      return {
        ...item,
        width: Math.max(6, Math.round((item.count / maxValue) * 100)),
        gradient: gradients[index] || "from-cyan-400 to-blue-500",
      };
    });
  }, [data.commandUsage]);

  async function toggleModule(moduleName: keyof DashboardPayload["modules"]) {
    if (!selectedGuildId) return;

    try {
      setSavingModule(moduleName);
      const nextValue = !data.modules[moduleName];
      const result = await updateModules(selectedGuildId, {
        [moduleName]: nextValue,
      });

      setData((current) => ({
        ...current,
        modules: result.modules,
      }));
    } catch (error) {
      console.error(error);
      setErrorText(error instanceof Error ? error.message : "Failed to update module.");
    } finally {
      setSavingModule("");
    }
  }

  const badge = (
    <div className="flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm">
      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
      <span className="text-white/70">
        {loading ? "Loading…" : data.botStatus === "online" ? "Live" : "Offline"}
      </span>
    </div>
  );

  return (
    <PanelLayout
      title="Bot Admin Dashboard"
      description="Live multi-server data from your Discord bot."
      guilds={guilds}
      selectedGuildId={selectedGuildId}
      onGuildChange={setSelectedGuildId}
      badge={badge}
    >
      {errorText && (
        <div className="mb-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {errorText}
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {statCards.map((card) => (
          <div
            key={card.title}
            className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/20"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-white/60">{card.title}</p>
                <p className="mt-2 text-3xl font-bold">{card.value}</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-2xl">
                {card.icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.55fr_1fr]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
            <h2 className="mb-5 text-xl font-bold">Server Overview</h2>

            <div className="space-y-4 text-sm sm:text-base">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <span className="text-white/60">Server Name</span>
                <span className="font-semibold">{data.primaryServerName}</span>
              </div>

              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <span className="text-white/60">Selected Guild Users</span>
                <span className="font-semibold">{formatNumber(data.totalUsers)}</span>
              </div>

              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <span className="text-white/60">Realtime Status</span>
                <span
                  className={`font-semibold ${
                    data.botStatus === "online" ? "text-emerald-300" : "text-rose-300"
                  }`}
                >
                  {data.botStatus === "online" ? "Connected" : "Offline"}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-white/60">Last Update</span>
                <span className="font-semibold">{formatRelative(data.lastUpdate)}</span>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
            <h2 className="mb-6 text-xl font-bold">Command Usage</h2>

            <div className="space-y-5">
              {topCommandUsage.map((item) => (
                <div key={item.label}>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-white/75">{item.label}</span>
                    <span className="text-white/50">{item.count}</span>
                  </div>

                  <div className="h-4 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${item.gradient}`}
                      style={{ width: `${item.width}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
            <h2 className="mb-5 text-xl font-bold">Recent Activity</h2>

            <div className="space-y-4">
              {data.recentActivity.length === 0 && (
                <div className="rounded-2xl border border-white/8 bg-black/10 px-4 py-3 text-sm text-white/60">
                  No activity yet for this server.
                </div>
              )}

              {data.recentActivity.slice(0, 5).map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-2xl border border-white/8 bg-black/10 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-xs font-bold text-white">
                      {index + 1}
                    </div>

                    <div>
                      <p className="text-sm text-white/85">{item.message}</p>
                      <p className="mt-1 text-xs uppercase tracking-wide text-white/40">
                        {item.type}
                      </p>
                    </div>
                  </div>

                  <span className="text-xs text-white/45">
                    {formatRelative(item.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
            <h2 className="mb-5 text-xl font-bold">Bot Controls</h2>

            <div className="space-y-4">
              {[
                { key: "welcomeMessages", label: "Welcome Messages" },
                { key: "autoModeration", label: "Auto Moderation" },
                { key: "musicModule", label: "Music Module" },
                { key: "antiSpamFilter", label: "Anti-Spam Filter" },
              ].map((control) => {
                const enabled = data.modules[control.key as keyof typeof data.modules];

                return (
                  <button
                    key={control.key}
                    type="button"
                    onClick={() =>
                      toggleModule(control.key as keyof DashboardPayload["modules"])
                    }
                    className="flex w-full items-center justify-between rounded-2xl border border-white/8 bg-black/10 px-4 py-3 text-left transition hover:bg-white/10"
                  >
                    <span className="text-sm font-medium text-white/85">
                      {control.label}
                    </span>

                    <div className="flex items-center gap-3">
                      <span
                        className={`text-sm font-semibold ${
                          enabled ? "text-emerald-300" : "text-rose-300"
                        }`}
                      >
                        {savingModule === control.key
                          ? "Saving..."
                          : enabled
                          ? "Enabled"
                          : "Disabled"}
                      </span>

                      <div
                        className={`relative h-7 w-14 rounded-full transition ${
                          enabled ? "bg-emerald-500/70" : "bg-rose-500/60"
                        }`}
                      >
                        <span
                          className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${
                            enabled ? "left-8" : "left-1"
                          }`}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
            <h2 className="mb-5 text-xl font-bold">System Metrics</h2>

            <div className="grid gap-4">
              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <p className="text-sm text-white/60">Ping</p>
                <p className="mt-2 text-2xl font-bold">{data.ping} ms</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <p className="text-sm text-white/60">Memory</p>
                <p className="mt-2 text-2xl font-bold">{data.memoryMb} MB</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <p className="text-sm text-white/60">CPU</p>
                <p className="mt-2 text-2xl font-bold">{data.cpuUsage}%</p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
            <h2 className="mb-5 text-xl font-bold">Moderation Logs</h2>

            <div className="space-y-4">
              {data.moderationLogs.length === 0 && (
                <div className="rounded-2xl border border-white/8 bg-black/10 px-4 py-3 text-sm text-white/60">
                  No moderation logs yet.
                </div>
              )}

              {data.moderationLogs.slice(0, 5).map((log) => (
                <div
                  key={log.id}
                  className="rounded-2xl border border-white/8 bg-black/10 px-4 py-3"
                >
                  <p className="text-sm text-white/85">{log.message}</p>
                  <p className="mt-1 text-xs text-white/45">
                    {formatRelative(log.timestamp)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </PanelLayout>
  );
}
