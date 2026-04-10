"use client";

import { useEffect, useMemo, useState } from "react";
import PanelLayout from "../components/PanelLayout";
import { fetchLogs, type LogsPayload } from "../lib/dashboardApi";
import { useSelectedGuild } from "../lib/useSelectedGuild";

const defaultData: LogsPayload = {
  ok: true,
  guild: { id: "", name: "No Server", memberCount: 0, iconUrl: null },
  logs: [],
  moderationLogs: [],
};

function formatRelative(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diffMs / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export default function LogsPage() {
  const { guilds, selectedGuildId, setSelectedGuildId } = useSelectedGuild();
  const [data, setData] = useState<LogsPayload>(defaultData);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (!selectedGuildId) return;
    let mounted = true;

    async function load() {
      try {
        const payload = await fetchLogs(selectedGuildId);
        if (mounted) setData(payload);
      } catch (error) {
        console.error(error);
      }
    }

    load();
    const intervalId = setInterval(load, 7000);

    return () => {
      mounted = false;
      clearInterval(intervalId);
    };
  }, [selectedGuildId]);

  const types = useMemo(
    () => ["all", ...Array.from(new Set(data.logs.map((log) => log.type)))],
    [data.logs]
  );

  const filteredLogs = useMemo(() => {
    return data.logs.filter((log) => filter === "all" || log.type === filter);
  }, [data.logs, filter]);

  return (
    <PanelLayout
      title="Logs"
      description="Every live dashboard event for the selected guild: commands, moderation, channels, roles and members."
      guilds={guilds}
      selectedGuildId={selectedGuildId}
      onGuildChange={setSelectedGuildId}
    >
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
        <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold">Recent Logs</h2>
            <p className="mt-1 text-sm text-white/55">
              Moderation log entries: {data.moderationLogs.length}
            </p>
          </div>

          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
          >
            {types.map((type) => (
              <option key={type} value={type} className="bg-[#111827]">
                {type}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-4">
          {filteredLogs.map((log) => (
            <div
              key={log.id}
              className="rounded-2xl border border-white/10 bg-black/10 p-4"
            >
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm text-white/85">{log.message}</p>
                  <p className="mt-1 text-xs uppercase tracking-wide text-white/40">
                    {log.type}
                  </p>
                </div>

                <span className="text-xs text-white/45">
                  {formatRelative(log.timestamp)}
                </span>
              </div>

              {log.rawCommand && (
                <pre className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-[#050913] p-3 text-xs text-white/65">
                  {log.rawCommand}
                </pre>
              )}
            </div>
          ))}

          {filteredLogs.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-black/10 p-4 text-sm text-white/60">
              No logs available for this filter.
            </div>
          )}
        </div>
      </section>
    </PanelLayout>
  );
}
