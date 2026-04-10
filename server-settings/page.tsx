"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  updateGeneralSettings,
  type SettingsPayload,
} from "../lib/dashboardApi";
import { useSelectedGuild } from "../lib/useSelectedGuild";

const defaultData: SettingsPayload = {
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
  textChannels: [],
  environment: {
    welcomeChannelId: null,
    logResultsChannelId: null,
    rulesCheckChannelId: null,
    getAccessChannelId: null,
    allowlistRoleId: null,
  },
  security: { writeAuthRequired: false },
};

export default function ServerSettingsPage() {
  const { guilds, selectedGuildId, setSelectedGuildId } = useSelectedGuild();
  const [data, setData] = useState<SettingsPayload>(defaultData);
  const [message, setMessage] = useState("");
  const [errorText, setErrorText] = useState("");
  const [parentCategoryId, setParentCategoryId] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [textChannelName, setTextChannelName] = useState("");
  const [voiceChannelName, setVoiceChannelName] = useState("");
  const [generalForm, setGeneralForm] = useState({
    prefix: "!",
    welcomeChannelId: "",
    logResultsChannelId: "",
    rulesCheckChannelId: "",
    getAccessChannelId: "",
  });

  async function loadSettings(guildId: string) {
    const payload = await fetchSettings(guildId);
    setData(payload);
    setGeneralForm({
      prefix: payload.prefix || "!",
      welcomeChannelId: payload.environment.welcomeChannelId || "",
      logResultsChannelId: payload.environment.logResultsChannelId || "",
      rulesCheckChannelId: payload.environment.rulesCheckChannelId || "",
      getAccessChannelId: payload.environment.getAccessChannelId || "",
    });
  }

  useEffect(() => {
    if (!selectedGuildId) return;
    loadSettings(selectedGuildId).catch((error) => {
      console.error(error);
      setErrorText(error instanceof Error ? error.message : "Failed to load settings.");
    });
  }, [selectedGuildId]);

  const textChannelOptions = useMemo(() => data.textChannels || [], [data.textChannels]);

  async function handleGeneralSave() {
    if (!selectedGuildId) return;
    try {
      await updateGeneralSettings(selectedGuildId, {
        prefix: generalForm.prefix,
        welcomeChannelId: generalForm.welcomeChannelId || null,
        logResultsChannelId: generalForm.logResultsChannelId || null,
        rulesCheckChannelId: generalForm.rulesCheckChannelId || null,
        getAccessChannelId: generalForm.getAccessChannelId || null,
      });
      await loadSettings(selectedGuildId);
      setErrorText("");
      setMessage("General settings saved.");
    } catch (error) {
      console.error(error);
      setErrorText(error instanceof Error ? error.message : "Failed to save general settings.");
    }
  }

  async function runAction(action: () => Promise<unknown>, successText: string) {
    if (!selectedGuildId) return;
    try {
      await action();
      await loadSettings(selectedGuildId);
      setErrorText("");
      setMessage(successText);
    } catch (error) {
      console.error(error);
      setErrorText(error instanceof Error ? error.message : "Action failed.");
    }
  }

  return (
    <PanelLayout
      title="Server Settings"
      description="Manage prefix, system channels, categories and channels in real time for the selected guild."
      guilds={guilds}
      selectedGuildId={selectedGuildId}
      onGuildChange={setSelectedGuildId}
    >
      {message && <Notice tone="success">{message}</Notice>}
      {errorText && <Notice tone="error">{errorText}</Notice>}

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.45fr]">
        <div className="space-y-5">
          <section className="border border-white/8 bg-white/[0.04] p-5 shadow-xl shadow-black/20">
            <h2 className="mb-4 text-xl font-bold">General Settings</h2>
            <div className="grid gap-4">
              <Field label="Server Name" value={data.guild.name} readOnly />
              <Field
                label="Bot Prefix"
                value={generalForm.prefix}
                onChange={(value) => setGeneralForm((current) => ({ ...current, prefix: value.slice(0, 4) }))}
              />
              <ChannelSelect
                label="Welcome Channel"
                value={generalForm.welcomeChannelId}
                onChange={(value) => setGeneralForm((current) => ({ ...current, welcomeChannelId: value }))}
                options={textChannelOptions}
              />
              <ChannelSelect
                label="Logs Channel"
                value={generalForm.logResultsChannelId}
                onChange={(value) => setGeneralForm((current) => ({ ...current, logResultsChannelId: value }))}
                options={textChannelOptions}
              />
              <ChannelSelect
                label="Rules Check Channel"
                value={generalForm.rulesCheckChannelId}
                onChange={(value) => setGeneralForm((current) => ({ ...current, rulesCheckChannelId: value }))}
                options={textChannelOptions}
              />
              <ChannelSelect
                label="Access Channel"
                value={generalForm.getAccessChannelId}
                onChange={(value) => setGeneralForm((current) => ({ ...current, getAccessChannelId: value }))}
                options={textChannelOptions}
              />
              <button
                type="button"
                onClick={() => handleGeneralSave().catch(console.error)}
                className="border border-cyan-400/25 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-200"
              >
                Save General Settings
              </button>
            </div>
          </section>

          <section className="border border-white/8 bg-white/[0.04] p-5 shadow-xl shadow-black/20">
            <h2 className="mb-4 text-xl font-bold">Create New</h2>
            <div className="space-y-3">
              <select
                value={parentCategoryId}
                onChange={(event) => setParentCategoryId(event.target.value)}
                className="w-full border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
              >
                <option value="">No parent category</option>
                {data.categories.map((category) => (
                  <option key={category.id} value={category.id} className="bg-[#111827]">
                    {category.name}
                  </option>
                ))}
              </select>

              <ActionRow>
                <input
                  value={categoryName}
                  onChange={(event) => setCategoryName(event.target.value)}
                  placeholder="New category name"
                  className="flex-1 border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() =>
                    runAction(
                      async () => {
                        await createCategory(selectedGuildId, { name: categoryName });
                        setCategoryName("");
                      },
                      "Category created."
                    ).catch(console.error)
                  }
                  className="border border-indigo-400/25 bg-indigo-500/10 px-4 py-3 text-sm font-semibold text-indigo-200"
                >
                  Create
                </button>
              </ActionRow>

              <ActionRow>
                <input
                  value={textChannelName}
                  onChange={(event) => setTextChannelName(event.target.value)}
                  placeholder="New text channel"
                  className="flex-1 border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() =>
                    runAction(
                      async () => {
                        await createTextChannel(selectedGuildId, {
                          name: textChannelName,
                          parentId: parentCategoryId || null,
                        });
                        setTextChannelName("");
                      },
                      "Text channel created."
                    ).catch(console.error)
                  }
                  className="border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200"
                >
                  Text
                </button>
              </ActionRow>

              <ActionRow>
                <input
                  value={voiceChannelName}
                  onChange={(event) => setVoiceChannelName(event.target.value)}
                  placeholder="New voice channel"
                  className="flex-1 border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() =>
                    runAction(
                      async () => {
                        await createVoiceChannel(selectedGuildId, {
                          name: voiceChannelName,
                          parentId: parentCategoryId || null,
                        });
                        setVoiceChannelName("");
                      },
                      "Voice channel created."
                    ).catch(console.error)
                  }
                  className="border border-sky-400/25 bg-sky-500/10 px-4 py-3 text-sm font-semibold text-sky-200"
                >
                  Voice
                </button>
              </ActionRow>
            </div>
          </section>
        </div>

        <div className="space-y-5">
          <EntityPanel title="Categories">
            {data.categories.map((category) => (
              <EditableRow
                key={category.id}
                label={category.name}
                protectedState={category.protected}
                onRename={(name) => renameCategory(selectedGuildId, category.id, { name })}
                onProtect={() => protectCategory(selectedGuildId, category.id)}
                onUnprotect={() => unprotectCategory(selectedGuildId, category.id)}
                onDelete={() => deleteCategory(selectedGuildId, category.id)}
                onComplete={() => loadSettings(selectedGuildId)}
              />
            ))}
          </EntityPanel>

          <EntityPanel title="Channels">
            {data.channels.map((channel) => (
              <EditableRow
                key={channel.id}
                label={channel.name}
                subtitle={channel.categoryName || (channel.type === 2 ? "voice" : "text")}
                protectedState={channel.protected}
                onRename={(name) => renameChannel(selectedGuildId, channel.id, { name })}
                onProtect={() => protectChannel(selectedGuildId, channel.id)}
                onUnprotect={() => unprotectChannel(selectedGuildId, channel.id)}
                onDelete={() => deleteChannel(selectedGuildId, channel.id)}
                onComplete={() => loadSettings(selectedGuildId)}
              />
            ))}
          </EntityPanel>
        </div>
      </div>
    </PanelLayout>
  );
}

function Notice({ tone, children }: { tone: "success" | "error"; children: string }) {
  return (
    <div
      className={`mb-4 border px-4 py-3 text-sm ${
        tone === "success"
          ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
          : "border-rose-400/20 bg-rose-500/10 text-rose-200"
      }`}
    >
      {children}
    </div>
  );
}

function ActionRow({ children }: { children: ReactNode }) {
  return <div className="flex gap-2">{children}</div>;
}

function Field({ label, value, onChange, readOnly }: { label: string; value: string; onChange?: (value: string) => void; readOnly?: boolean }) {
  return (
    <label className="border border-white/10 bg-black/10 p-4">
      <span className="block text-sm text-white/55">{label}</span>
      <input
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange?.(event.target.value)}
        className="mt-2 w-full bg-transparent text-lg font-semibold outline-none"
      />
    </label>
  );
}

function ChannelSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ id: string; name: string }> }) {
  return (
    <label className="border border-white/10 bg-black/10 p-4">
      <span className="block text-sm text-white/55">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full bg-transparent text-base font-semibold outline-none"
      >
        <option value="">Not configured</option>
        {options.map((channel) => (
          <option key={channel.id} value={channel.id} className="bg-[#111827]">
            #{channel.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function EntityPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border border-white/8 bg-white/[0.04] p-5 shadow-xl shadow-black/20">
      <h2 className="mb-4 text-xl font-bold">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function EditableRow({
  label,
  subtitle,
  protectedState,
  onRename,
  onProtect,
  onUnprotect,
  onDelete,
  onComplete,
}: {
  label: string;
  subtitle?: string | null;
  protectedState: boolean;
  onRename: (name: string) => Promise<unknown>;
  onProtect: () => Promise<unknown>;
  onUnprotect: () => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onComplete: () => Promise<unknown>;
}) {
  const [nextName, setNextName] = useState(label);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    try {
      setBusy(true);
      await action();
      await onComplete();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-white/10 bg-black/10 p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="min-w-0 flex-1">
          <input
            value={nextName}
            onChange={(event) => setNextName(event.target.value)}
            className="w-full border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
          />
          {subtitle && <p className="mt-2 text-xs text-white/45">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => run(() => onRename(nextName))} className="border border-white/10 bg-white/[0.05] px-4 py-3 text-sm">Rename</button>
          <button type="button" disabled={busy} onClick={() => run(() => (protectedState ? onUnprotect() : onProtect()))} className="border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{protectedState ? "Unprotect" : "Protect"}</button>
          <button type="button" disabled={busy} onClick={() => run(onDelete)} className="border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">Delete</button>
        </div>
      </div>
    </div>
  );
}
