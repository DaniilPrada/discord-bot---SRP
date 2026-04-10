"use client";

import { useEffect, useState } from "react";
import PanelLayout from "../components/PanelLayout";
import {
  createCategory,
  createTextChannel,
  createVoiceChannel,
  deleteCategory,
  deleteChannel,
  fetchSettings,
  protectCategory,
  protectChannel,
  renameCategory,
  renameChannel,
  unprotectCategory,
  unprotectChannel,
  type SettingsPayload,
} from "../lib/dashboardApi";
import { useSelectedGuild } from "../lib/useSelectedGuild";

const defaultSettings: SettingsPayload = {
  ok: true,
  guild: { id: "", name: "No Server", memberCount: 0, iconUrl: null },
  prefix: "!",
  modules: {
    welcomeMessages: true,
    autoModeration: true,
    musicModule: true,
    antiSpamFilter: false,
  },
  protection: { channels: [], categories: [] },
  categories: [],
  channels: [],
  roles: [],
  environment: {
    welcomeChannelId: null,
    logResultsChannelId: null,
    allowlistRoleId: null,
  },
};

export default function ServerSettingsPage() {
  const { guilds, selectedGuildId, setSelectedGuildId } = useSelectedGuild();
  const [data, setData] = useState<SettingsPayload>(defaultSettings);
  const [textChannelName, setTextChannelName] = useState("");
  const [voiceChannelName, setVoiceChannelName] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [parentCategoryId, setParentCategoryId] = useState("");
  const [message, setMessage] = useState("");

  async function loadSettings(guildId: string) {
    const payload = await fetchSettings(guildId);
    setData(payload);
  }

  useEffect(() => {
    if (!selectedGuildId) return;
    loadSettings(selectedGuildId).catch(console.error);
  }, [selectedGuildId]);

  async function handleCreateTextChannel() {
    if (!selectedGuildId || !textChannelName.trim()) return;
    await createTextChannel(selectedGuildId, {
      name: textChannelName,
      parentId: parentCategoryId || null,
    });
    setTextChannelName("");
    await loadSettings(selectedGuildId);
    setMessage("Text channel created.");
  }

  async function handleCreateVoiceChannel() {
    if (!selectedGuildId || !voiceChannelName.trim()) return;
    await createVoiceChannel(selectedGuildId, {
      name: voiceChannelName,
      parentId: parentCategoryId || null,
    });
    setVoiceChannelName("");
    await loadSettings(selectedGuildId);
    setMessage("Voice channel created.");
  }

  async function handleCreateCategory() {
    if (!selectedGuildId || !categoryName.trim()) return;
    await createCategory(selectedGuildId, { name: categoryName });
    setCategoryName("");
    await loadSettings(selectedGuildId);
    setMessage("Category created.");
  }

  return (
    <PanelLayout
      title="Server Settings"
      description="Create, rename, protect and delete channels/categories in real time for the selected guild."
      guilds={guilds}
      selectedGuildId={selectedGuildId}
      onGuildChange={setSelectedGuildId}
    >
      {message && (
        <div className="mb-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {message}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_1.35fr]">
        <div className="space-y-6">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
            <h2 className="mb-5 text-xl font-bold">General Settings</h2>

            <div className="grid gap-4">
              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <p className="text-sm text-white/60">Server Name</p>
                <p className="mt-2 text-lg font-semibold">{data.guild.name}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <p className="text-sm text-white/60">Bot Prefix</p>
                <p className="mt-2 text-lg font-semibold">{data.prefix}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <p className="text-sm text-white/60">Welcome Channel ID</p>
                <p className="mt-2 break-all text-sm font-semibold">
                  {data.environment.welcomeChannelId || "Not configured"}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <p className="text-sm text-white/60">Logs Channel ID</p>
                <p className="mt-2 break-all text-sm font-semibold">
                  {data.environment.logResultsChannelId || "Not configured"}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
            <h2 className="mb-5 text-xl font-bold">Create New</h2>

            <div className="space-y-4">
              <select
                value={parentCategoryId}
                onChange={(event) => setParentCategoryId(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
              >
                <option value="">No parent category</option>
                {data.categories.map((category) => (
                  <option key={category.id} value={category.id} className="bg-[#111827]">
                    {category.name}
                  </option>
                ))}
              </select>

              <div className="flex gap-2">
                <input
                  value={categoryName}
                  onChange={(event) => setCategoryName(event.target.value)}
                  placeholder="New category name"
                  className="flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleCreateCategory().catch(console.error)}
                  className="rounded-2xl border border-indigo-400/20 bg-indigo-500/10 px-4 py-3 text-sm font-semibold text-indigo-200"
                >
                  Create
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  value={textChannelName}
                  onChange={(event) => setTextChannelName(event.target.value)}
                  placeholder="New text channel"
                  className="flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleCreateTextChannel().catch(console.error)}
                  className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200"
                >
                  Text
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  value={voiceChannelName}
                  onChange={(event) => setVoiceChannelName(event.target.value)}
                  placeholder="New voice channel"
                  className="flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleCreateVoiceChannel().catch(console.error)}
                  className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-200"
                >
                  Voice
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
            <h2 className="mb-5 text-xl font-bold">Roles</h2>

            <div className="flex flex-wrap gap-2">
              {data.roles.map((role) => (
                <span
                  key={role.id}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/75"
                >
                  {role.name}
                </span>
              ))}

              {data.roles.length === 0 && (
                <span className="text-sm text-white/50">No roles available.</span>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
            <h2 className="mb-5 text-xl font-bold">Categories</h2>

            <div className="space-y-4">
              {data.categories.map((category) => (
                <CategoryCard
                  key={category.id}
                  guildId={selectedGuildId}
                  categoryId={category.id}
                  name={category.name}
                  protectedState={category.protected}
                  onRefresh={() => selectedGuildId && loadSettings(selectedGuildId)}
                />
              ))}

              {data.categories.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-black/10 p-4 text-sm text-white/60">
                  No categories yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
            <h2 className="mb-5 text-xl font-bold">Channels</h2>

            <div className="space-y-4">
              {data.channels.map((channel) => (
                <ChannelCard
                  key={channel.id}
                  guildId={selectedGuildId}
                  channelId={channel.id}
                  name={channel.name}
                  protectedState={channel.protected}
                  categoryName={channel.categoryName}
                  categories={data.categories}
                  typeLabel={channel.type === 2 ? "voice" : "text"}
                  onRefresh={() => selectedGuildId && loadSettings(selectedGuildId)}
                />
              ))}

              {data.channels.length === 0 && (
                <div className="rounded-2xl border border-white/10 bg-black/10 p-4 text-sm text-white/60">
                  No channels yet.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </PanelLayout>
  );
}

function CategoryCard({
  guildId,
  categoryId,
  name,
  protectedState,
  onRefresh,
}: {
  guildId: string;
  categoryId: string;
  name: string;
  protectedState: boolean;
  onRefresh: () => void;
}) {
  const [nextName, setNextName] = useState(name);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <input
          value={nextName}
          onChange={(event) => setNextName(event.target.value)}
          className="flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              renameCategory(guildId, categoryId, { name: nextName })
                .then(onRefresh)
                .catch(console.error)
            }
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
          >
            Rename
          </button>

          <button
            type="button"
            onClick={() =>
              (protectedState
                ? unprotectCategory(guildId, categoryId)
                : protectCategory(guildId, categoryId)
              )
                .then(onRefresh)
                .catch(console.error)
            }
            className={`rounded-2xl border px-4 py-3 text-sm ${
              protectedState
                ? "border-yellow-400/20 bg-yellow-500/10 text-yellow-200"
                : "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
            }`}
          >
            {protectedState ? "Unprotect" : "Protect"}
          </button>

          <button
            type="button"
            onClick={() =>
              deleteCategory(guildId, categoryId)
                .then(onRefresh)
                .catch(console.error)
            }
            className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function ChannelCard({
  guildId,
  channelId,
  name,
  protectedState,
  categoryName,
  categories,
  typeLabel,
  onRefresh,
}: {
  guildId: string;
  channelId: string;
  name: string;
  protectedState: boolean;
  categoryName: string | null;
  categories: Array<{ id: string; name: string }>;
  typeLabel: string;
  onRefresh: () => void;
}) {
  const [nextName, setNextName] = useState(name);
  const [nextParentId, setNextParentId] = useState("");

  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/75">
          {typeLabel}
        </span>
        <span className="text-xs text-white/45">
          parent: {categoryName || "none"}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <input
          value={nextName}
          onChange={(event) => setNextName(event.target.value)}
          className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
        />

        <select
          value={nextParentId}
          onChange={(event) => setNextParentId(event.target.value)}
          className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
        >
          <option value="">Keep / no category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id} className="bg-[#111827]">
              {category.name}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              renameChannel(guildId, channelId, {
                name: nextName,
                parentId: nextParentId || undefined,
              })
                .then(onRefresh)
                .catch(console.error)
            }
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
          >
            Rename
          </button>

          <button
            type="button"
            onClick={() =>
              (protectedState
                ? unprotectChannel(guildId, channelId)
                : protectChannel(guildId, channelId)
              )
                .then(onRefresh)
                .catch(console.error)
            }
            className={`rounded-2xl border px-4 py-3 text-sm ${
              protectedState
                ? "border-yellow-400/20 bg-yellow-500/10 text-yellow-200"
                : "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
            }`}
          >
            {protectedState ? "Unprotect" : "Protect"}
          </button>

          <button
            type="button"
            onClick={() =>
              deleteChannel(guildId, channelId).then(onRefresh).catch(console.error)
            }
            className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
