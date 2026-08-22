import { useState } from "react";
import { createReplayStorage, type ReplayStorage } from "@bylina/storage";
import { isReplayJournal, type ReplayJournal } from "@bylina/replay";
import { useServices, useT } from "./context.js";
import { useI18nTick } from "./hooks.js";

function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 4 6.5 10l6 6" />
    </svg>
  );
}

/**
 * Экран сохранённых повторов партий (roadmap 0.17.0): журналы состязательных
 * боёв, записанные при завершении либо обрыве соединения.
 */
export function ReplayScreen() {
  useI18nTick();
  const t = useT();
  const { session } = useServices();
  const [storage] = useState<ReplayStorage>(() => createReplayStorage());
  const [, setTick] = useState(0);
  const replays = storage.listReplays().filter(isReplayJournal) as ReplayJournal[];

  const refresh = (): void => setTick((value) => value + 1);

  return (
    <div className="screen menu-screen replay-screen">
      <header className="menu-brand">
        <p className="eyebrow">{t("app.subtitle")}</p>
        <h1 className="display-title">{t("replay.title")}</h1>
        <p className="muted">{t("replay.hint")}</p>
      </header>

      {replays.length === 0 ? (
        <p className="muted">{t("replay.empty")}</p>
      ) : (
        <div className="replay-list" role="list" aria-label={t("replay.title")}>
          {replays.map((journal) => (
            <div key={journal.createdAt} className="replay-row" role="listitem">
              <div className="replay-meta">
                <span className="replay-title">{journal.title}</span>
                <span className="muted">
                  {new Date(journal.createdAt).toLocaleString()} · {journal.options.side1.length}×{journal.options.side2.length} ·{" "}
                  {journal.winner === null ? t("replay.aborted") : t("replay.winner", { side: journal.winner })}
                </span>
              </div>
              <div className="replay-actions">
                <button type="button" className="btn btn-primary" onClick={() => session.startReplay(journal)}>
                  {t("replay.watch")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    storage.deleteReplay(journal.createdAt);
                    refresh();
                  }}
                >
                  {t("replay.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <nav className="menu-nav">
        <button type="button" className="btn btn-ghost" onClick={() => session.goTo("menu")}>
          <BackIcon />
          {t("common.back")}
        </button>
      </nav>
    </div>
  );
}
