"use client";

import { useEffect, useMemo, useState } from "react";
import PanelLayout from "../components/PanelLayout";
import {
  addMemberRole,
  fetchSettings,
  fetchUsers,
  removeMemberRole,
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
  environment: {
    welcomeChannelId: null,
    logResultsChannelId: null,
    allowlistRoleId: null,
  },
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

export default function UsersPage() {
  const { guilds, selectedGuildId, setSelectedGuildId } = useSelectedGuild();
  const [usersData, setUsersData] = useState<UsersPayload>(defaultUsers);
  const [settings, setSettings] = useState<SettingsPayload>(defaultSettings);
  const [search, setSearch] = useState("");
  const [selectedRoleByUser, setSelectedRoleByUser] = useState<Record<string, string>>({});

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
    loadData(selectedGuildId).catch(console.error);
  }, [selectedGuildId]);

  const filteredUsers = useMemo(() => {
    return usersData.users.filter((user) => {
      const text = `${user.displayName} ${user.username} ${user.tag} ${user.roles.join(" ")}`.toLowerCase();
      return text.includes(search.toLowerCase());
    });
  }, [search, usersData.users]);

  async function handleAddRole(userId: string) {
    const roleId = selectedRoleByUser[userId];
    if (!selectedGuildId || !roleId) return;
    await addMemberRole(selectedGuildId, userId, roleId);
    await loadData(selectedGuildId);
  }

  async function handleRemoveRole(userId: string, roleId: string) {
    if (!selectedGuildId) return;
    await removeMemberRole(selectedGuildId, userId, roleId);
    await loadData(selectedGuildId);
  }

  return (
    <PanelLayout
      title="Users"
      description="Live user list for the selected guild, including roles, rank stats and quick role actions."
      guilds={guilds}
      selectedGuildId={selectedGuildId}
      onGuildChange={setSelectedGuildId}
    >
      <section className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl shadow-black/20">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-xl font-bold">User Management</h2>
            <p className="mt-1 text-sm text-white/55">
              Total members loaded: {usersData.users.length}
            </p>
          </div>

          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search users, tags or roles"
            className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none xl:w-[360px]"
          />
        </div>

        <div className="space-y-4">
          {filteredUsers.map((user) => (
            <div
              key={user.id}
              className="rounded-3xl border border-white/10 bg-black/10 p-5"
            >
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="flex items-start gap-4">
                  <img
                    src={user.avatarUrl || "https://placehold.co/96x96/png"}
                    alt={user.displayName}
                    className="h-14 w-14 rounded-2xl border border-white/10 object-cover"
                  />

                  <div>
                    <p className="text-lg font-semibold">{user.displayName}</p>
                    <p className="text-sm text-white/55">{user.tag}</p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                        top role: {user.highestRole}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                        messages: {formatNumber(user.messages)}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                        level: {user.level}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                        xp: {formatNumber(user.xp)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 xl:w-[360px]">
                  <div className="flex gap-2">
                    <select
                      value={selectedRoleByUser[user.id] || ""}
                      onChange={(event) =>
                        setSelectedRoleByUser((current) => ({
                          ...current,
                          [user.id]: event.target.value,
                        }))
                      }
                      className="flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none"
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
                      onClick={() => handleAddRole(user.id).catch(console.error)}
                      className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200"
                    >
                      Add
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
                            role && handleRemoveRole(user.id, role.id).catch(console.error)
                          }
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/75"
                        >
                          {roleName} ✕
                        </button>
                      );
                    })}

                    {user.roles.length === 0 && (
                      <span className="text-xs text-white/45">No roles assigned.</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {filteredUsers.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-black/10 p-4 text-sm text-white/60">
              No users match the current search.
            </div>
          )}
        </div>
      </section>
    </PanelLayout>
  );
}
