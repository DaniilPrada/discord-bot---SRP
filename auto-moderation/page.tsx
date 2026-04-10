"use client";

import { useEffect, useState } from "react";
import PanelLayout from "../components/PanelLayout";
import {
  fetchDashboard,
  updateModules,
  type DashboardPayload,
} from "../lib/dashboardApi";
import { useSelectedGuild } from "../lib/useSelectedGuild";

const defaultData: DashboardPayload = {
  ok: true,
  guild: { id: "", name: "No Server", memberCount: 0, iconUrl: null },
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

export default function AutoModerationPage() {
  const { guilds, selectedGuildId, setSelectedGuildId } = useSelectedGuild();
  const [data, setData] = useState<DashboardPayload>(defaultData);

  useEffect(() => {
    if (!selectedGuildId) return;
    fetchDashboard(selectedGuildId).then(setData).catch(console.error);
  }, [selectedGuildId]);

  async function toggle(key: keyof DashboardPayload["modules"]) {
    if (!selectedGuildId) return;
    const result = await updateModules(selectedGuildId, {
      [key]: !data.modules[key],
    });
    setData((current) => ({
      ...current,
      modules: result.modules,
    }));
  }

  const cards = [
    {
      key: "autoModeration" as const,
      name: "Third-party Link Auto Ban",
      description: "Uses the real auto-ban module from the bot.",
    },
    {
      key: "antiSpamFilter" as const,
      name: "Anti-Spam Filter",
      description: "Runtime dashboard toggle for future spam filtering logic.",
    },
    {
      key: "welcomeMessages" as const,
      name: "Welcome Messages",
      description: "Controls guildMemberAdd welcome embeds.",
    },
    {
      key: "musicModule" as const,
      name: "Music Module",
      description: "Controls music commands from the dashboard.",
    },
  ];

  return (
    <PanelLayout
      title="Auto Moderation"
      description="Manage runtime bot modules for the selected guild."
      guilds={guilds}
      selectedGuildId={selectedGuildId}
      onGuildChange={setSelectedGuildId}
    >
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
        <h2 className="mb-5 text-xl font-bold">Moderation & Runtime Modules</h2>

        <div className="space-y-4">
          {cards.map((rule) => {
            const enabled = data.modules[rule.key];

            return (
              <button
                key={rule.key}
                type="button"
                onClick={() => toggle(rule.key).catch(console.error)}
                className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-black/10 p-4 text-left transition hover:bg-white/10"
              >
                <div>
                  <p className="font-medium">{rule.name}</p>
                  <p className="mt-1 text-sm text-white/55">{rule.description}</p>
                </div>

                <span
                  className={`text-sm font-semibold ${
                    enabled ? "text-emerald-300" : "text-rose-300"
                  }`}
                >
                  {enabled ? "Enabled" : "Disabled"}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </PanelLayout>
  );
}
