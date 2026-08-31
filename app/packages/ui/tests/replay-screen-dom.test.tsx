// @vitest-environment jsdom
/**
 * День 6 (0.21.5): совместимость повторов на экране. Журнал другой версии
 * правил помечается предупреждением и проигрывается только после
 * подтверждения; журнал неподдерживаемого формата не воспроизводится молча —
 * у строки нет кнопки просмотра, но её можно удалить.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { act } from "react";
import { createReplayStorage } from "@bylina/storage";
import { createReplayRecorder, REPLAY_FORMAT_VERSION, RULES_VERSION, type ReplayJournal } from "@bylina/replay";
import type { PvpMatchOptions } from "@bylina/core";
import { byText, mountBattleShell, press } from "./harness.js";

const STORAGE_KEY = "bylina.replays.v1";

function makeJournal(title: string, createdAt: number): ReplayJournal {
  const options: PvpMatchOptions = {
    units: [],
    map: {
      width: 6,
      height: 6,
      pitChance: 0,
      coverDensity: 0,
      wallDensity: 0,
      edgeCoverChance: 0,
      halfCoverChance: 0,
      heightMix: { z0: 1, z1: 0, z2: 0 },
    },
    side1: ["unit-a"],
    side2: ["unit-b"],
    objective: "elimination",
    seed: 1,
  };
  const journal = createReplayRecorder(options, title).finish(1, title);
  return { ...journal, createdAt };
}

/** Сырая запись прежнего формата (строковый version) — не воспроизводима. */
function makeLegacyEntry(createdAt: number): unknown {
  return { version: "0.20.x", createdAt, commands: [], options: {} };
}

function seedStorage(entries: unknown[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function labeledButtons(host: HTMLElement, label: string): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll("button")).filter((el) => (el.textContent ?? "").trim() === label);
}

/** Смонтировать оболочку и открыть экран повторов. */
async function mountReplays() {
  const shell = await mountBattleShell();
  act(() => {
    shell.services.session.goTo("replays");
  });
  return shell;
}

describe("экран повторов: совместимость", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("повтор другой версии правил помечается и проигрывается после подтверждения", async () => {
    const other = { ...makeJournal("Сетевой бой", 1_000), rulesVersion: RULES_VERSION + 1 };
    seedStorage([other]);
    const { mounted, services } = await mountReplays();
    const host = mounted.host;
    expect(host.textContent).toContain("Другие правила");
    // Кнопка строки — «Смотреть всё равно»; клик открывает предупреждение.
    await press(byText("Смотреть всё равно"));
    expect(services.session.get().screen).not.toBe("battle");
    const modal = host.querySelector(".modal-root");
    expect(modal).not.toBeNull();
    // В модалке — кнопка подтверждения; после неё повтор запускается.
    const confirmButton = Array.from(host.querySelectorAll<HTMLButtonElement>(".modal-root button")).find((el) =>
      (el.textContent ?? "").includes("Смотреть всё равно"),
    );
    expect(confirmButton).not.toBeNull();
    await press(confirmButton!);
    expect(services.session.get().screen).toBe("battle");
    await mounted.unmount();
  });

  it("повтор прежнего формата не имеет кнопки просмотра, но удаляется", async () => {
    const ok = makeJournal("Локальный бой", 2_000);
    seedStorage([ok, makeLegacyEntry(3_000)]);
    const { mounted } = await mountReplays();
    const host = mounted.host;
    expect(host.textContent).toContain("Недоступен");
    // Две кнопки «Удалить» (ok и неподдерживаемый), но лишь одна «Смотреть».
    expect(labeledButtons(host, "Смотреть").length).toBe(1);
    expect(labeledButtons(host, "Удалить").length).toBe(2);
    // Удаление неподдерживаемой строки: в хранилище остаётся валидный повтор.
    await press(labeledButtons(host, "Удалить")[1]!);
    expect(host.textContent).not.toContain("Недоступен");
    expect(createReplayStorage().listReplays().length).toBe(1);
    await mounted.unmount();
  });

  it("повтор несовместимой форматной версии помечается неподдерживаемым", async () => {
    const future = { ...makeJournal("Будущий формат", 4_000), formatVersion: REPLAY_FORMAT_VERSION + 1 };
    seedStorage([future]);
    const { mounted } = await mountReplays();
    const host = mounted.host;
    expect(host.textContent).toContain("Недоступен");
    expect(labeledButtons(host, "Смотреть").length).toBe(0);
    expect(labeledButtons(host, "Смотреть всё равно").length).toBe(0);
    await mounted.unmount();
  });
});
