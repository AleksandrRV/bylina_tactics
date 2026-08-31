import { useState } from "react";
import { createReplayStorage, type ReplayStorage } from "@bylina/storage";
import { isReplayJournal, replayCompatibility, type ReplayCompatibility, type ReplayJournal } from "@bylina/replay";
import { useServices, useT } from "./context.js";
import { useI18nTick } from "./hooks.js";

function BackIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.5 4 6.5 10l6 6" />
    </svg>
  );
}

/**
 * Запись списка повторов: валидный журнал его класса совместимости либо
 * повреждённая/нечитаемая запись. Журналы прежнего формата (поле
 * `version: string`) не проходят isReplayJournal и помечаются как
 * неподдерживаемые — не воспроизводятся молча (0.21.5, день 5/6).
 */
interface ReplayEntry {
  journal: ReplayJournal;
  compatibility: ReplayCompatibility;
  createdAt: number;
}

function readEntries(storage: ReplayStorage): ReplayEntry[] {
  const entries: ReplayEntry[] = [];
  for (const raw of storage.listReplays()) {
    if (isReplayJournal(raw)) {
      entries.push({ journal: raw, compatibility: replayCompatibility(raw), createdAt: raw.createdAt });
    } else if (
      typeof raw === "object" &&
      raw !== null &&
      typeof (raw as { createdAt?: unknown }).createdAt === "number"
    ) {
      // Запись прежнего формата: не воспроизводима, но её можно удалить.
      entries.push({
        journal: raw as unknown as ReplayJournal,
        compatibility: "unsupported",
        createdAt: (raw as { createdAt: number }).createdAt,
      });
    }
  }
  return entries;
}

/**
 * Экран сохранённых повторов партий (roadmap 0.17.0): журналы состязательных
 * боёв, записанные при завершении либо обрыве соединения. Повтор, записанный
 * другой версией правил, помечается и проигрывается только после
 * предупреждения; неподдерживаемый формат не воспроизводится (0.21.5).
 */
export function ReplayScreen() {
  useI18nTick();
  const t = useT();
  const { session } = useServices();
  const [storage] = useState<ReplayStorage>(() => createReplayStorage());
  const [, setTick] = useState(0);
  /** Журнал, по которому показано предупреждение «другие правила». */
  const [confirming, setConfirming] = useState<ReplayEntry | null>(null);
  const entries = readEntries(storage);

  const refresh = (): void => {
    setConfirming(null);
    setTick((value) => value + 1);
  };

  const play = (entry: ReplayEntry): void => {
    if (entry.compatibility === "otherRules") {
      setConfirming(entry);
      return;
    }
    if (entry.compatibility === "unsupported") return;
    session.startReplay(entry.journal);
  };

  return (
    <div className="screen menu-screen replay-screen">
      <header className="menu-brand">
        <p className="eyebrow">{t("app.subtitle")}</p>
        <h1 className="display-title">{t("replay.title")}</h1>
        <p className="muted">{t("replay.hint")}</p>
      </header>

      {entries.length === 0 ? (
        <p className="muted">{t("replay.empty")}</p>
      ) : (
        <div className="replay-list" role="list" aria-label={t("replay.title")}>
          {entries.map((entry) => {
            const { journal, compatibility } = entry;
            const unsupported = compatibility === "unsupported";
            const otherRules = compatibility === "otherRules";
            return (
              <div key={entry.createdAt} className="replay-row" role="listitem">
                <div className="replay-meta">
                  <span className="replay-title">
                    {unsupported ? t("replay.unsupported") : journal.title}
                    {otherRules ? (
                      <span className="replay-badge replay-badge-warn" title={t("replay.otherRulesNote")}>
                        {t("replay.otherRules")}
                      </span>
                    ) : unsupported ? (
                      <span className="replay-badge replay-badge-off" title={t("replay.unsupportedNote")}>
                        {t("replay.unsupported")}
                      </span>
                    ) : null}
                  </span>
                  <span className="muted">
                    {unsupported
                      ? t("replay.unsupportedNote")
                      : `${new Date(journal.createdAt).toLocaleString()} · ${journal.options.side1.length}×${journal.options.side2.length} · ${
                          journal.winner === null ? t("replay.aborted") : t("replay.winner", { side: journal.winner })
                        }`}
                  </span>
                </div>
                <div className="replay-actions">
                  {unsupported ? null : (
                    <button type="button" className="btn btn-primary" onClick={() => play(entry)}>
                      {otherRules ? t("replay.otherRulesWatch") : t("replay.watch")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      storage.deleteReplay(entry.createdAt);
                      refresh();
                    }}
                  >
                    {t("replay.delete")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirming ? (
        <div className="modal-root" role="presentation" onClick={() => setConfirming(null)}>
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="replay-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="replay-confirm-title">{t("replay.otherRules")}</h2>
            <p className="muted">{t("replay.otherRulesNote")}</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirming(null)}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  session.startReplay(confirming.journal);
                  setConfirming(null);
                }}
              >
                {t("replay.otherRulesWatch")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <nav className="menu-nav">
        <button type="button" className="btn btn-ghost" onClick={() => session.goTo("menu")}>
          <BackIcon />
          {t("common.back")}
        </button>
      </nav>
    </div>
  );
}
