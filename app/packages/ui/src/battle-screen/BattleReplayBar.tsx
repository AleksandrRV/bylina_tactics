import { useBattleScreen } from "./context.js";

export function BattleReplayBar() {
  const model = useBattleScreen();

  if (!model.isReplay) return null;

  return (
    <div className="replay-bar" role="status">
      <span className="replay-label">{model.t("replay.watching")}</span>
      <span className="replay-progress">
        <i
          style={{
            width: `${
              model.replayJournal
                ? Math.min(100, (model.replayIndex / Math.max(1, model.replayJournal.commands.length)) * 100)
                : 0
            }%`,
          }}
        />
      </span>
      <span className="muted">
        {model.replayIndex}/{model.replayJournal?.commands.length ?? 0}
      </span>
      {model.replayDone ? <span className="replay-done">{model.t("replay.done")}</span> : null}
    </div>
  );
}
