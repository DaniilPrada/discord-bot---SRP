"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import PanelLayout from "../components/PanelLayout";
import {
  addMemberRole,
  banMember,
  clearMemberWarns,
  fetchSettings,
  fetchUsers,
  kickMember,
  muteMember,
  removeMemberRole,
  unbanMember,
  unmuteMember,
  warnMember,
  type SettingsPayload,
  type UsersPayload,
} from "../lib/dashboardApi";
import { useSelectedGuild } from "../lib/useSelectedGuild";

const defaultUsers: UsersPayload = {
  ok: true,
  guild: { id: "", name: "No Server", memberCount: 0, iconUrl: null },
  users: [],
};

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

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function formatRelative(value?: string | number | null) {
  if (!value) return "never";
  const date = new Date(typeof value === "number" ? value : value);
  if (Number.isNaN(date.getTime())) return "never";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diffMs / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export default function UsersPage() {
  const { guilds, selectedGuildId, setSelectedGuildId } = useSelectedGuild();
  const [usersData, setUsersData] = useState<UsersPayload>(defaultUsers);
  const [settings, setSettings] = useState<SettingsPayload>(defaultSettings);
  const [search, setSearch] = useState("");
  const [selectedRoleByUser, setSelectedRoleByUser] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [errorText, setErrorText] = useState("");

  async function loadData(guildId: string) {
    const [usersPayload, settingsPayload] = await Promise.all([
      fetchUsers(guildId),
      fetchSettings(guildId),
    ]);
    setUsersData(usersPayload);
    setSettings(settingsPayload);
  }

  useEffect(() => {
    if (!selectedGuildId) return;
    loadData(selectedGuildId).catch((error) => {
      console.error(error);
      setErrorText(error instanceof Error ? error.message : "Failed to load users.");
    });
  }, [selectedGuildId]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return usersData.users;
    return usersData.users.filter((user) =>
      [user.displayName, user.tag, user.username, user.highestRole, ...user.roles]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [search, usersData.users]);

  async function runAction(action: () => Promise<unknown>, successText: string) {
    if (!selectedGuildId) return;
    try {
      await action();
      await loadData(selectedGuildId);
      setErrorText("");
      setMessage(successText);
    } catch (error) {
      console.error(error);
      setErrorText(error instanceof Error ? error.message : "Action failed.");
    }
  }

  return (
    <PanelLayout
      title="Users"
      description="Live user list for the selected guild, including roles, punishments and direct moderation actions."
      guilds={guilds}
      selectedGuildId={selectedGuildId}
      onGuildChange={setSelectedGuildId}
    >
      {message && <Banner tone="success">{message}</Banner>}
      {errorText && <Banner tone="error">{errorText}</Banner>}

      <section className="border border-white/8 bg-white/[0.04] p-5 shadow-xl shadow-black/20">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-xl font-bold">User Management</h2>
            <p className="mt-1 text-sm text-white/55">Total members loaded: {usersData.users.length}</p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search users, tags or roles"
            className="border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none xl:w-[360px]"
          />
        </div>

        <div className="space-y-4">
          {filteredUsers.map((user) => (
            <div key={user.id} className="border border-white/10 bg-black/10 p-4">
              <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
                <div className="flex items-start gap-4">
                  <img
                    src={user.avatarUrl || "https://placehold.co/96x96/png"}
                    alt={user.displayName}
                    className="h-14 w-14 border border-white/10 object-cover"
                  />
                  <div>
                    <p className="text-lg font-semibold">{user.displayName}</p>
                    <p className="text-sm text-white/55">{user.tag}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/70">
                      <Badge>top role: {user.highestRole}</Badge>
                      <Badge>messages: {formatNumber(user.messages)}</Badge>
                      <Badge>level: {user.level}</Badge>
                      <Badge>xp: {formatNumber(user.xp)}</Badge>
                      <Badge>warns: {user.warns.length}</Badge>
                      <Badge>bans: {user.bans.length}</Badge>
                      <Badge>timeout: {user.timedOutUntil ? formatRelative(user.timedOutUntil) : "none"}</Badge>
                    </div>
                    {user.warns.length > 0 && (
                      <div className="mt-3 space-y-1 text-xs text-amber-200/85">
                        {user.warns.slice(0, 3).map((warn, index) => (
                          <p key={`${user.id}-warn-${index}`}>⚠ {warn.reason || "No reason"} · {formatRelative(warn.timestamp)}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 2xl:w-[470px]">
                  <div className="flex gap-2">
                    <select
                      value={selectedRoleByUser[user.id] || ""}
                      onChange={(event) =>
                        setSelectedRoleByUser((current) => ({
                          ...current,
                          [user.id]: event.target.value,
                        }))
                      }
                      className="flex-1 border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
                    >
                      <option value="">Choose role to add</option>
                      {settings.roles.map((role) => (
                        <option key={role.id} value={role.id} className="bg-[#111827]">
                          {role.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        runAction(
                          () => addMemberRole(selectedGuildId, user.id, selectedRoleByUser[user.id]),
                          `Added role to ${user.displayName}.`
                        ).catch(console.error)
                      }
                      className="border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200"
                    >
                      Add Role
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {user.roles.map((roleName) => {
                      const role = settings.roles.find((item) => item.name === roleName);
                      return (
                        <button
                          key={`${user.id}-${roleName}`}
                          type="button"
                          onClick={() =>
                            role &&
                            runAction(
                              () => removeMemberRole(selectedGuildId, user.id, role.id),
                              `Removed ${role.name} from ${user.displayName}.`
                            ).catch(console.error)
                          }
                          className="border border-white/10 bg-white/[0.05] px-3 py-1 text-xs text-white/75"
                        >
                          {roleName} ✕
                        </button>
                      );
                    })}
                  </div>

                  <ModerationPanel
                    onWarn={(reason) => runAction(() => warnMember(selectedGuildId, user.id, reason), `Warned ${user.displayName}.`)}
                    onClearWarns={() => runAction(() => clearMemberWarns(selectedGuildId, user.id), `Cleared warnings for ${user.displayName}.`)}
                    onMute={(duration, reason) => runAction(() => muteMember(selectedGuildId, user.id, duration, reason), `Muted ${user.displayName}.`)}
                    onUnmute={() => runAction(() => unmuteMember(selectedGuildId, user.id), `Unmuted ${user.displayName}.`)}
                    onKick={(reason) => runAction(() => kickMember(selectedGuildId, user.id, reason), `Kicked ${user.displayName}.`)}
                    onBan={(duration, reason) => runAction(() => banMember(selectedGuildId, user.id, duration, reason), `Banned ${user.displayName}.`)}
                    onUnban={(reason) => runAction(() => unbanMember(selectedGuildId, user.id, reason), `Unbanned ${user.displayName}.`)}
                  />
                </div>
              </div>
            </div>
          ))}

          {filteredUsers.length === 0 && <div className="border border-white/10 bg-black/10 p-4 text-sm text-white/60">No users match the current search.</div>}
        </div>
      </section>
    </PanelLayout>
  );
}

function ModerationPanel({
  onWarn,
  onClearWarns,
  onMute,
  onUnmute,
  onKick,
  onBan,
  onUnban,
}: {
  onWarn: (reason: string) => Promise<void>;
  onClearWarns: () => Promise<void>;
  onMute: (duration: string, reason: string) => Promise<void>;
  onUnmute: () => Promise<void>;
  onKick: (reason: string) => Promise<void>;
  onBan: (duration: string, reason: string) => Promise<void>;
  onUnban: (reason: string) => Promise<void>;
}) {
  const [warnReason, setWarnReason] = useState("");
  const [muteReason, setMuteReason] = useState("");
  const [muteDuration, setMuteDuration] = useState("10m");
  const [banReason, setBanReason] = useState("");
  const [banDuration, setBanDuration] = useState("");

  return (
    <div className="grid gap-3 border border-white/10 bg-[#060a15] p-4">
      <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
        <input value={warnReason} onChange={(event) => setWarnReason(event.target.value)} placeholder="Warn reason" className="border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none" />
        <button type="button" onClick={() => onWarn(warnReason || "No reason").catch(console.error)} className="border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">Warn</button>
        <button type="button" onClick={() => onClearWarns().catch(console.error)} className="border border-white/10 bg-white/[0.05] px-3 py-2 text-sm">Clear Warns</button>
      </div>

      <div className="grid gap-2 md:grid-cols-[120px_1fr_auto_auto]">
        <input value={muteDuration} onChange={(event) => setMuteDuration(event.target.value)} placeholder="10m" className="border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none" />
        <input value={muteReason} onChange={(event) => setMuteReason(event.target.value)} placeholder="Mute reason" className="border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none" />
        <button type="button" onClick={() => onMute(muteDuration, muteReason || "No reason").catch(console.error)} className="border border-sky-400/25 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">Mute</button>
        <button type="button" onClick={() => onUnmute().catch(console.error)} className="border border-white/10 bg-white/[0.05] px-3 py-2 text-sm">Unmute</button>
      </div>

      <div className="grid gap-2 md:grid-cols-[120px_1fr_auto_auto]">
        <input value={banDuration} onChange={(event) => setBanDuration(event.target.value)} placeholder="1d or empty" className="border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none" />
        <input value={banReason} onChange={(event) => setBanReason(event.target.value)} placeholder="Ban or kick reason" className="border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none" />
        <button type="button" onClick={() => onBan(banDuration, banReason || "No reason").catch(console.error)} className="border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">Ban</button>
        <button type="button" onClick={() => onKick(banReason || "No reason").catch(console.error)} className="border border-white/10 bg-white/[0.05] px-3 py-2 text-sm">Kick</button>
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={() => onUnban(banReason || "No reason").catch(console.error)} className="border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">Unban</button>
      </div>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="border border-white/10 bg-white/[0.05] px-3 py-1">{children}</span>;
}

function Banner({ tone, children }: { tone: "success" | "error"; children: string }) {
  return (
    <div className={`mb-4 border px-4 py-3 text-sm ${tone === "success" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200" : "border-rose-400/20 bg-rose-500/10 text-rose-200"}`}>
      {children}
    </div>
  );
}
