"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchGuilds, type GuildSummary } from "./dashboardApi";

const STORAGE_KEY = "dashboard:selectedGuildId";

export function useSelectedGuild() {
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [selectedGuildId, setSelectedGuildIdState] = useState("");
  const [loadingGuilds, setLoadingGuilds] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadGuilds() {
      try {
        const response = await fetchGuilds();
        if (!mounted) return;

        const nextGuilds = response.guilds || [];
        setGuilds(nextGuilds);

        const storedGuildId =
          typeof window !== "undefined"
            ? window.localStorage.getItem(STORAGE_KEY) || ""
            : "";

        const preferredGuild =
          nextGuilds.find((guild) => guild.id === storedGuildId) ||
          nextGuilds[0] ||
          null;

        setSelectedGuildIdState(preferredGuild?.id || "");
      } catch (error) {
        console.error(error);
      } finally {
        if (mounted) {
          setLoadingGuilds(false);
        }
      }
    }

    loadGuilds();

    return () => {
      mounted = false;
    };
  }, []);

  const setSelectedGuildId = (guildId: string) => {
    setSelectedGuildIdState(guildId);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, guildId);
    }
  };

  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === selectedGuildId) || null,
    [guilds, selectedGuildId]
  );

  return {
    guilds,
    selectedGuildId,
    setSelectedGuildId,
    selectedGuild,
    loadingGuilds,
  };
}
