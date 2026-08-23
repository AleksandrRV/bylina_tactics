import type { SessionApi } from "@bylina/session";

/** Network role projection used by the battle UI. */
export function useBattleNetwork(session: SessionApi, battleKind: string | null) {
  const netRole = battleKind === "pvpNet" ? session.get().netRole : null;
  return {
    netRole,
    isNetGuest: netRole === "guest",
    isSpectator: netRole === "spectator",
    netOwner: battleKind === "pvpNet" ? session.get().netOwner : null,
    disconnected: session.get().netDisconnected === true,
  };
}
