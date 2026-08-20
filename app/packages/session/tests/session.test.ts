import { describe, expect, it } from "vitest";
import { createSession } from "../src/index.js";

describe("createSession", () => {
  it("starts on the boot screen", () => {
    expect(createSession().get().screen).toBe("boot");
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
    session.openMode("quickMatch");
    expect(session.get().screen).toBe("menu");
    expect(session.get().unavailableMode).toBe("quickMatch");
    session.dismissUnavailable();
    expect(session.get().unavailableMode).toBeNull();
  });

  it("opens the debug field", () => {
    const session = createSession("menu");
    session.openField();
    expect(session.get().screen).toBe("field");
  });
});
