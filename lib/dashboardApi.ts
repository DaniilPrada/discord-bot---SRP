export const API_BASE =
  process.env.NEXT_PUBLIC_DASHBOARD_SERVER_URL || "http://localhost:4001";

export type GuildSummary = {
  id: string;
  name: string;
  memberCount: number;
  iconUrl: string | null;
  ownerId?: string | null;
};

export type BotModules = {
  welcomeMessages: boolean;
  autoModeration: boolean;
  musicModule: boolean;
  antiSpamFilter: boolean;
};

export type DashboardLog = {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  commandName?: string;
  rawCommand?: string;
};

export type CommandItem = {
  name: string;
  category: string;
  description: string;
  moderatorOnly: boolean;
  usageCount: number;
  enabled: boolean;
};

export type DashboardPayload = {
  ok: boolean;
  guild: GuildSummary;
  primaryServerName: string;
  primaryServerMembers: number;
  totalServers: number;
  totalUsers: number;
  activeCommands: number;
  bannedUsers: number;
  totalMessages: number;
  botStatus: "online" | "offline" | "starting";
  ping: number;
  memoryMb: number;
  cpuUsage: number;
  modules: BotModules;
  lastUpdate: string | null;
  recentActivity: DashboardLog[];
  moderationLogs: DashboardLog[];
  commandUsage: Array<{
    name: string;
    label: string;
    count: number;
  }>;
};

export type UsersPayload = {
  ok: boolean;
  guild: GuildSummary;
  users: Array<{
    id: string;
    username: string;
    displayName: string;
    tag: string;
    avatarUrl: string | null;
    joinedAt: string | null;
    highestRole: string;
    roleIds: string[];
    roles: string[];
    xp: number;
    level: number;
    messages: number;
  }>;
};

export type CommandsPayload = {
  ok: boolean;
  guild: GuildSummary;
  totalCommands: number;
  commands: CommandItem[];
};

export type LogsPayload = {
  ok: boolean;
  guild: GuildSummary;
  logs: DashboardLog[];
  moderationLogs: DashboardLog[];
};

export type SettingsPayload = {
  ok: boolean;
  guild: GuildSummary;
  prefix: string;
  modules: BotModules;
  protection: {
    channels: string[];
    categories: string[];
  };
  categories: Array<{
    id: string;
    name: string;
    type: number;
    parentId: string | null;
    position: number;
    categoryName: string | null;
    protected: boolean;
  }>;
  channels: Array<{
    id: string;
    name: string;
    type: number;
    parentId: string | null;
    position: number;
    categoryName: string | null;
    protected: boolean;
  }>;
  roles: Array<{
    id: string;
    name: string;
    color: string;
    position: number;
    managed: boolean;
    mentionable: boolean;
  }>;
  environment: {
    welcomeChannelId: string | null;
    logResultsChannelId: string | null;
    allowlistRoleId: string | null;
  };
};

async function requestJson<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }

  return payload as T;
}

export function fetchGuilds() {
  return requestJson<{ ok: boolean; guilds: GuildSummary[] }>("/api/guilds");
}

export function fetchDashboard(guildId: string) {
  return requestJson<DashboardPayload>(
    `/api/guilds/${guildId}/dashboard`
  );
}

export function fetchUsers(guildId: string) {
  return requestJson<UsersPayload>(`/api/guilds/${guildId}/users`);
}

export function fetchCommands(guildId: string) {
  return requestJson<CommandsPayload>(`/api/guilds/${guildId}/commands`);
}

export function fetchLogs(guildId: string) {
  return requestJson<LogsPayload>(`/api/guilds/${guildId}/logs`);
}

export function fetchSettings(guildId: string) {
  return requestJson<SettingsPayload>(`/api/guilds/${guildId}/settings`);
}

export function updateModules(
  guildId: string,
  modules: Partial<BotModules>
) {
  return requestJson<{ ok: boolean; modules: BotModules }>(
    `/api/guilds/${guildId}/modules`,
    {
      method: "PATCH",
      body: JSON.stringify(modules),
    }
  );
}

export function createTextChannel(
  guildId: string,
  payload: { name: string; parentId?: string | null }
) {
  return requestJson<{ ok: boolean }>(
    `/api/guilds/${guildId}/channels/text`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}

export function createVoiceChannel(
  guildId: string,
  payload: { name: string; parentId?: string | null }
) {
  return requestJson<{ ok: boolean }>(
    `/api/guilds/${guildId}/channels/voice`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}

export function createCategory(guildId: string, payload: { name: string }) {
  return requestJson<{ ok: boolean }>(`/api/guilds/${guildId}/categories`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function renameChannel(
  guildId: string,
  channelId: string,
  payload: { name?: string; parentId?: string | null }
) {
  return requestJson<{ ok: boolean }>(
    `/api/guilds/${guildId}/channels/${channelId}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );
}

export function renameCategory(
  guildId: string,
  categoryId: string,
  payload: { name?: string }
) {
  return requestJson<{ ok: boolean }>(
    `/api/guilds/${guildId}/categories/${categoryId}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );
}

export function deleteChannel(guildId: string, channelId: string) {
  return requestJson<{ ok: boolean }>(
    `/api/guilds/${guildId}/channels/${channelId}`,
    {
      method: "DELETE",
    }
  );
}

export function deleteCategory(guildId: string, categoryId: string) {
  return requestJson<{ ok: boolean }>(
    `/api/guilds/${guildId}/categories/${categoryId}`,
    {
      method: "DELETE",
    }
  );
}

export function protectChannel(guildId: string, channelId: string) {
  return requestJson<{ ok: boolean }>(
    `/api/guilds/${guildId}/protect/channel/${channelId}`,
    { method: "POST" }
  );
}

export function unprotectChannel(guildId: string, channelId: string) {
  return requestJson<{ ok: boolean }>(
    `/api/guilds/${guildId}/protect/channel/${channelId}`,
    { method: "DELETE" }
  );
}

export function protectCategory(guildId: string, categoryId: string) {
  return requestJson<{ ok: boolean }>(
    `/api/guilds/${guildId}/protect/category/${categoryId}`,
    { method: "POST" }
  );
}

export function unprotectCategory(guildId: string, categoryId: string) {
  return requestJson<{ ok: boolean }>(
    `/api/guilds/${guildId}/protect/category/${categoryId}`,
    { method: "DELETE" }
  );
}

export function addMemberRole(
  guildId: string,
  memberId: string,
  roleId: string
) {
  return requestJson<{ ok: boolean }>(
    `/api/guilds/${guildId}/members/${memberId}/roles`,
    {
      method: "POST",
      body: JSON.stringify({ roleId }),
    }
  );
}

export function removeMemberRole(
  guildId: string,
  memberId: string,
  roleId: string
) {
  return requestJson<{ ok: boolean }>(
    `/api/guilds/${guildId}/members/${memberId}/roles/${roleId}`,
    {
      method: "DELETE",
    }
  );
}
