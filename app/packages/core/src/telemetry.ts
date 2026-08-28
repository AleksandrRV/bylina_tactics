/** Локальный журнал телеметрии пролога (doc/campaign.md §13.9). Без сети. */

export type TelemetryEvent =
  | { type: "hint_shown"; key: string }
  | { type: "restart_pressed"; missionId: string }
  | { type: "death_by"; cause: string }
  | { type: "objective_time"; missionId: string; ms: number }
  | { type: "reinforcement_triggered"; missionId: string }
  | { type: "skip_cutscene"; missionId: string };

export interface TelemetryLog {
  events: TelemetryEvent[];
}

export function createTelemetryLog(): TelemetryLog {
  return { events: [] };
}

export function recordTelemetry(log: TelemetryLog, event: TelemetryEvent): TelemetryLog {
  return { events: [...log.events, event] };
}

export function skipCutsceneRate(log: TelemetryLog, missionId: string): number {
  const skips = log.events.filter((event) => event.type === "skip_cutscene" && event.missionId === missionId).length;
  return skips;
}
