import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  getLaunchOptions: vi.fn(async () => ({ found: false, value: "" })),
  recordLaunchOptions: vi.fn(async () => ({})),
}));
vi.mock("./hooks/useRunningGame", () => ({ readLaunchOptions: vi.fn(async () => null) }));

import {
  hasOverride,
  isShortcutAppid,
  launchOptionFor,
  mergeLaunchOptions,
  safeLaunchWrite,
  stripOverride,
} from "./launchOptions";

const ours = 'WINEDLLOVERRIDES="dxgi=n,b" %command%';

describe("mergeLaunchOptions — launcher shortcut styles", () => {
  it("keeps a Xodus Nexus /bin/sh shortcut's script and game id after the marker", () => {
    const current = '"/home/deck/.config/xodus-nexus/shortcuts/launch-game" "80454a304a71cb22"';
    expect(mergeLaunchOptions(current, ours)).toBe(
      'WINEDLLOVERRIDES="dxgi=n,b" %command% "/home/deck/.config/xodus-nexus/shortcuts/launch-game" "80454a304a71cb22"',
    );
  });

  it("keeps a shortcut that launches the AppImage directly", () => {
    const current =
      '--launch-game "80454a304a71cb22" --nexus-profile "/home/deck/.config/xodus-nexus"';
    expect(mergeLaunchOptions(current, ours)).toBe(
      'WINEDLLOVERRIDES="dxgi=n,b" %command% --launch-game "80454a304a71cb22" --nexus-profile "/home/deck/.config/xodus-nexus"',
    );
  });

  it("keeps a bare uplay:// argument shortcut working", () => {
    expect(mergeLaunchOptions("uplay://launch/1234", ours)).toBe(
      'WINEDLLOVERRIDES="dxgi=n,b" %command% uplay://launch/1234',
    );
  });

  it("puts the override with the assignments of an Epic NSL shortcut", () => {
    const current =
      'STEAM_COMPAT_DATA_PATH="/home/deck/Steam/epic" %command% com.epicgames.launcher://apps/abc?action=launch';
    expect(mergeLaunchOptions(current, ours)).toBe(
      'STEAM_COMPAT_DATA_PATH="/home/deck/Steam/epic" WINEDLLOVERRIDES="dxgi=n,b" %command% com.epicgames.launcher://apps/abc?action=launch',
    );
  });

  it("repairs the argument-first form an earlier release wrote", () => {
    const current =
      'WINEDLLOVERRIDES="dxgi=n,b" "/home/deck/.config/xodus-nexus/shortcuts/launch-game" "80454a304a71cb22"';
    expect(mergeLaunchOptions(current, ours)).toBe(
      'WINEDLLOVERRIDES="dxgi=n,b" %command% "/home/deck/.config/xodus-nexus/shortcuts/launch-game" "80454a304a71cb22"',
    );
  });

  it("does not stack a second override on reinstall", () => {
    const current = 'WINEDLLOVERRIDES="dxgi=n,b" %command% uplay://launch/1234';
    expect(mergeLaunchOptions(current, ours)).toBe(
      'WINEDLLOVERRIDES="dxgi=n,b" %command% uplay://launch/1234',
    );
  });

  it("folds our override into an assignment that already carries REFramework's dinput8", () => {
    const current = 'WINEDLLOVERRIDES="dxgi=n,b;dinput8=n,b" %command% -dx12';
    expect(mergeLaunchOptions(current, ours)).toBe(
      'WINEDLLOVERRIDES="dxgi=n,b;dinput8=n,b" %command% -dx12',
    );
  });

  it("writes only the override into an empty field", () => {
    expect(mergeLaunchOptions(null, ours)).toBe(ours);
    expect(mergeLaunchOptions("", ours)).toBe(ours);
  });

  it("keeps a Steam game's own arguments after the marker", () => {
    expect(mergeLaunchOptions("%command% -dx12", ours)).toBe(
      'WINEDLLOVERRIDES="dxgi=n,b" %command% -dx12',
    );
  });

  it("leaves a field that already matches alone", () => {
    expect(mergeLaunchOptions(ours, ours)).toBe(ours);
  });

  it("keeps an .asi plan from adding any override", () => {
    const current = '"/home/deck/.config/xodus-nexus/shortcuts/launch-game" "80454a304a71cb22"';
    expect(mergeLaunchOptions(current, "%command%")).toBe(
      '%command% "/home/deck/.config/xodus-nexus/shortcuts/launch-game" "80454a304a71cb22"',
    );
  });
});

describe("stripOverride", () => {
  it("removes only our proxy and keeps REFramework's", () => {
    expect(stripOverride('WINEDLLOVERRIDES="dxgi=n,b;dinput8=n,b" %command%', "dxgi.dll")).toBe(
      'WINEDLLOVERRIDES="dinput8=n,b" %command%',
    );
  });

  it("removes the whole assignment when it was ours alone", () => {
    expect(stripOverride('WINEDLLOVERRIDES="dxgi=n,b" %command% -dx12', "dxgi.dll")).toBe(
      "%command% -dx12",
    );
  });

  it("collapses a bare leftover %command%", () => {
    expect(stripOverride('WINEDLLOVERRIDES="dxgi=n,b" %command%', "dxgi.dll")).toBe("");
  });

  it("leaves options without our override untouched", () => {
    expect(stripOverride("%command% -dx12", "dxgi.dll")).toBe("%command% -dx12");
  });
});

describe("safeLaunchWrite — write nothing a shortcut cannot afford to lose", () => {
  const shortcut = 3057189284;

  it("refuses to replace options Steam will not report for a shortcut", () => {
    expect(safeLaunchWrite(shortcut, null, ours)).toBeNull();
    expect(safeLaunchWrite(String(shortcut), null, ours)).toBeNull();
  });

  it("writes for a shortcut whose options are known", () => {
    expect(safeLaunchWrite(shortcut, '"/path/launch-game" "id"', "x")).toBe("x");
  });

  it("writes for a Steam game even when nothing can be read", () => {
    expect(safeLaunchWrite(1234, null, "x")).toBe("x");
  });
});

describe("isShortcutAppid", () => {
  it("recognises shortcut ids in every form they arrive in", () => {
    expect(isShortcutAppid(3057189284)).toBe(true);
    expect(isShortcutAppid("3057189284")).toBe(true);
    expect(isShortcutAppid(-1237583112)).toBe(true);
    expect(isShortcutAppid(1234)).toBe(false);
    expect(isShortcutAppid("1234")).toBe(false);
    expect(isShortcutAppid(null)).toBe(false);
    expect(isShortcutAppid("")).toBe(false);
  });
});

describe("override helpers", () => {
  it("builds the override for a dll and only the marker for an asi", () => {
    expect(launchOptionFor("dxgi.dll")).toBe(ours);
    expect(launchOptionFor("OptiPatcher.asi")).toBe("%command%");
  });

  it("sees the override in a folded assignment", () => {
    expect(hasOverride('WINEDLLOVERRIDES="dxgi=n,b;dinput8=n,b" %command%', "dxgi.dll")).toBe(
      true,
    );
    expect(hasOverride('WINEDLLOVERRIDES="dinput8=n,b" %command%', "dxgi.dll")).toBe(false);
  });
});
