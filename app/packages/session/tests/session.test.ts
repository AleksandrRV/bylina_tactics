import { describe, expect, it } from "vitest";
import { APP_VERSION, createSession } from "../src/index.js";

describe("createSession", () => {
  it("starts on the boot screen", () => {
    expect(createSession().get().screen).toBe("boot");
  });

  it("reports version 0.8.0", () => {
    expect(APP_VERSION).toBe("0.8.0");
  });

  it("moves between menu and settings", () => {
    const session = createSession("menu");
    session.goTo("settings");
    expect(session.get().screen).toBe("settings");
    session.goTo("menu");
    expect(session.get().screen).toBe("menu");
  });

  it("records an unavailable mode without leaving the menu", () => {
    const session = createSession("menu");
    session.openMode("campaign");
    expect(session.get().screen).toBe("menu");
    expect(session.get().unavailableMode).toBe("campaign");
    session.dismissUnavailable();
    expect(session.get().unavailableMode).toBeNull();
  });

  it("opens quick match difficulty and starts a battle", () => {
    const session = createSession("menu");
    session.openQuickMatch();
    expect(session.get().screen).toBe("difficulty");
    session.selectDifficulty("hard");
    expect(session.get().screen).toBe("battle");
    expect(session.get().battleKind).toBe("quick");
    expect(session.get().difficulty).toBe("hard");
    session.finishMatch("victory");
    expect(session.get().screen).toBe("result");
    expect(session.get().outcome).toBe("victory");
    session.playAgain();
    expect(session.get().screen).toBe("difficulty");
  });
});
