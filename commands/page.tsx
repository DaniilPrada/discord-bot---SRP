"use client";

import { useEffect, useMemo, useState } from "react";
import PanelLayout from "../components/PanelLayout";
import { fetchCommands, type CommandsPayload } from "../lib/dashboardApi";
import { useSelectedGuild } from "../lib/useSelectedGuild";

const defaultData: CommandsPayload = {
  ok: true,
  guild: { id: "", name: "No Server", memberCount: 0, iconUrl: null },
  totalCommands: 0,
  commands: [],
};

export default function CommandsPage() {
  const { guilds, selectedGuildId, setSelectedGuildId } = useSelectedGuild();
  const [data, setData] = useState<CommandsPayload>(defaultData);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  useEffect(() => {
    if (!selectedGuildId) return;

    let mounted = true;

    fetchCommands(selectedGuildId)
      .then((payload) => {
        if (mounted) setData(payload);
      })
      .catch(console.error);

    return () => {
      mounted = false;
    };
  }, [selectedGuildId]);

  const categories = useMemo(() => {
    return ["all", ...Array.from(new Set(data.commands.map((item) => item.category)))];
  }, [data.commands]);

  const filteredCommands = useMemo(() => {
    return data.commands.filter((command) => {
      const matchesSearch =
        command.name.toLowerCase().includes(search.toLowerCase()) ||
        command.description.toLowerCase().includes(search.toLowerCase());

      const matchesCategory = category === "all" || command.category === category;
      return matchesSearch && matchesCategory;
    });
  }, [category, data.commands, search]);

  return (
    <PanelLayout
      title="Commands"
      description="Every command registered in the bot, with live usage counts per selected guild."
      guilds={guilds}
      selectedGuildId={selectedGuildId}
      onGuildChange={setSelectedGuildId}
    >
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-xl font-bold">Available Commands</h2>
            <p className="mt-1 text-sm text-white/55">
              Total executions in this guild: {data.totalCommands}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search command"
              className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
            />

            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
            >
              {categories.map((item) => (
                <option key={item} value={item} className="bg-[#111827]">
                  {item}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-4">
          {filteredCommands.map((command) => (
            <div
              key={command.name}
              className="rounded-2xl border border-white/10 bg-black/10 p-4"
            >
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-lg font-semibold">!{command.name}</p>
                  <p className="mt-1 text-sm text-white/60">
                    {command.description}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/70">
                    {command.category}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/70">
                    uses: {command.usageCount}
                  </span>
                  <span
                    className={`rounded-full border px-3 py-1 ${
                      command.moderatorOnly
                        ? "border-orange-400/30 bg-orange-500/10 text-orange-200"
                        : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                    }`}
                  >
                    {command.moderatorOnly ? "moderator" : "public"}
                  </span>
                </div>
              </div>
            </div>
          ))}

          {filteredCommands.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-black/10 p-4 text-sm text-white/60">
              No commands match the current filters.
            </div>
          )}
        </div>
      </section>
    </PanelLayout>
  );
}
