/**
 * The Steam launch options this plugin writes, and how to take them back out.
 *
 * Installing OptiScaler is two changes, not one: a folder full of files, and a
 * `WINEDLLOVERRIDES` entry in Steam. Removing it used to undo only the first,
 * so a game that had been "removed" still carried an override for a DLL that
 * was no longer there — harmless, but it is litter this plugin left behind and
 * nothing on screen admitted to it.
 *
 * Undoing the second half properly needs to know what was there first, which
 * only Steam can say and only while the plugin is running. `record_launch_options`
 * is therefore called at install time with whatever Steam currently passes, and
 * the answer is kept next to the install. Three things then become tellable
 * apart, which is the whole point:
 *
 * - **recorded and empty** — the game had no launch options at all, so removing
 *   OptiScaler can clear the field outright.
 * - **recorded and not empty** — there is something to put back, verbatim.
 * - **not recorded** — the install predates this, or Steam would not say. Only
 *   the override this plugin recognises is removed; anything else is left, on
 *   the grounds that it is not ours to guess about.
 */
import { getLaunchOptions, recordLaunchOptions } from "./api";
import { readLaunchOptions } from "./hooks/useRunningGame";
import type { LaunchRecord } from "./types";

/** What to do with the launch options when OptiScaler is removed. */
export type LaunchAction = "restore" | "clear" | "keep";

export interface LaunchState {
  /** Steam's current launch options, or null when the client will not say. */
  current: string | null;
  /** What was there before the install, or null when nothing was recorded. */
  recorded: string | null;
  /** The proxy filename OptiScaler is installed as, e.g. `dxgi.dll`. */
  filename: string;
}

export interface LaunchChoice {
  action: LaunchAction;
  label: string;
  description: string;
  /** What Steam would be set to, or null to leave the field untouched. */
  value: string | null;
}

/** The `WINEDLLOVERRIDES` entry an install under this filename adds. */
export function overrideStem(filename: string): string {
  return filename.replace(/\.(dll|asi)$/i, "");
}

export function launchOptionFor(filename: string): string {
  if (filename.toLowerCase().endsWith(".asi")) return "%command%";
  return `WINEDLLOVERRIDES="${overrideStem(filename)}=n,b" %command%`;
}

export function hasOverride(options: string | null, filename: string): boolean {
  if (!options) return false;
  return options.toLowerCase().includes(`${overrideStem(filename).toLowerCase()}=n,b`);
}

/**
 * The same launch options with our override taken out and nothing else.
 *
 * Conservative on purpose: a user may have added `-dx12` or a gamescope
 * wrapper of their own alongside the override, and those are not this plugin's
 * to delete. Only a `WINEDLLOVERRIDES=` assignment naming the proxy we
 * installed is dropped. A leftover bare `%command%` is Steam's own default
 * written out longhand, so that collapses to an empty field.
 */
/**
 * The DLL entries of a WINEDLLOVERRIDES value, in Wine's own grammar: tokens
 * are separated by commas and semicolons alike, and a token without an "="
 * is a load-order flag of the entry before it — "dxgi=n,b" is one entry with
 * two flags, not an entry and a half.
 */
function assignmentEntries(value: string): string[] {
  const entries: string[] = [];
  for (const token of value.split(/[,;]/)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    if (trimmed.includes("=") || entries.length === 0) entries.push(trimmed);
    else entries[entries.length - 1] += "," + trimmed;
  }
  return entries;
}

function stripStems(options: string, stems: string[]): string {
  const ours = new Set(stems.map((stem) => stem.toLowerCase()));
  const entries = assignmentEntries;
  const without = options.replace(
    /WINEDLLOVERRIDES=(?:"([^"]*)"|'([^']*)'|(\S+))/gi,
    (match, dq: string, sq: string, bare: string) => {
      const value = dq ?? sq ?? bare ?? "";
      const kept = entries(value).filter(
        (entry) => !ours.has(entry.split("=")[0].toLowerCase()),
      );
      if (kept.length === entries(value).length) return match;
      return kept.length ? 'WINEDLLOVERRIDES="' + kept.join(";") + '"' : "";
    },
  );
  const collapsed = without.replace(/\s+/g, " ").trim();
  return collapsed === "%command%" ? "" : collapsed;
}

export function stripOverride(options: string, filename: string): string {
  return stripStems(options, [overrideStem(filename)]);
}

/** The DLL stems a launch-options string of ours claims to manage. */
function managedStems(options: string): string[] {
  const assignments = options.match(/WINEDLLOVERRIDES=(?:"[^"]*"|'[^']*'|\S+)/gi) ?? [];
  return assignments.flatMap((assignment) =>
    assignmentEntries(
      assignment
        .replace(/^WINEDLLOVERRIDES=/i, "")
        .replace(/^["']|["']$/g, ""),
    )
      .map((entry) => entry.split("=")[0])
      .filter(Boolean),
  );
}

/**
 * Ours in front of theirs, with two `WINEDLLOVERRIDES` assignments folded
 * into one: a shell keeps only the last assignment of a name, so two would
 * silently drop whichever came first — REF's `dinput8` when this plugin's
 * `dxgi` is written over it, or the other way around.
 */
function joinAssignments(head: string, ourHead: string): string {
  if (!ourHead) return head;
  if (!head) return ourHead;
  const assignment = /WINEDLLOVERRIDES=(?:"([^"]*)"|'([^']*)'|(\S+))/i;
  const theirs = head.match(assignment);
  const mine = ourHead.match(assignment);
  if (theirs && mine) {
    const value = [
      mine[1] ?? mine[2] ?? mine[3] ?? "",
      theirs[1] ?? theirs[2] ?? theirs[3] ?? "",
    ].filter(Boolean).join(";");
    return head.replace(assignment, 'WINEDLLOVERRIDES="' + value + '"');
  }
  return head + " " + ourHead;
}

/**
 * Our override written into whatever the game is launched with today.
 *
 * A plain replace used to be enough for a Steam game, which starts with no
 * launch options of its own. Launcher shortcuts are different, in two shapes,
 * and both must survive verbatim:
 *
 * - options with `%command%` in them (NonSteamLaunchers' style: environment
 *   assignments, the marker, then the URL that starts the game —
 *   `com.epicgames.launcher://`, `uplay://`, `bnet://`). The override joins
 *   the assignments before the marker.
 * - options that are only arguments (Xodus Nexus' style: a `launch-game`
 *   script path and the game's id, or the AppImage with `--launch-game`, and
 *   no marker at all). Steam puts a shortcut's exe in front of those, so an
 *   assignment at the front of the options lands in the game's argument list
 *   instead of its environment — Xodus forwards it as the game's id and
 *   refuses to start. The marker goes in first: Steam writes the exe at
 *   `%command%`, so the assignment lands in front of the command where the
 *   shell reads it, and every argument the shortcut needs stays after it,
 *   untouched.
 *
 * Our own override is taken out of the existing options before the merge, so
 * a reinstall never stacks a second copy — and a merge repairs options an
 * earlier release wrote in the argument-first form that broke launchers.
 */
export function mergeLaunchOptions(existing: string | null, ours: string): string {
  const current = (existing ?? "").trim();
  const wanted = ours.trim();
  if (!current) return wanted;
  if (current === wanted) return current;
  const base = stripStems(current, managedStems(wanted));
  const marker = "%command%";
  const oi = wanted.indexOf(marker);
  if (oi < 0) return wanted + " " + base;
  const ourHead = wanted.slice(0, oi).trim();
  const ourTail = wanted.slice(oi + marker.length).trim();
  const ci = base.indexOf(marker);
  if (ci < 0) {
    const tail = [ourTail, base].filter(Boolean).join(" ");
    return [ourHead, marker, tail].filter(Boolean).join(" ");
  }
  const head = joinAssignments(base.slice(0, ci).trim(), ourHead);
  const tail = [ourTail, base.slice(ci + marker.length).trim()].filter(Boolean).join(" ");
  return [head, marker, tail].filter(Boolean).join(" ");
}

/**
 * Whether an app id names a non-Steam shortcut rather than a Steam app.
 *
 * Steam derives every shortcut id with the top bit set, and no real app id
 * has it — the same distinction the backend reads a shortcut's launch options
 * by.
 */
export function isShortcutAppid(appid: string | number | null): boolean {
  if (appid === null || appid === "") return false;
  const id = typeof appid === "number" ? appid : Number(appid);
  if (!Number.isSafeInteger(id)) return false;
  const unsigned = id < 0 ? id + 4294967296 : id;
  return unsigned >= 2147483648;
}

/**
 * What may be written back into Steam's launch options, or null when nothing
 * may be written at all.
 *
 * A non-Steam shortcut's options carry the arguments that start its game —
 * Xodus Nexus' launch script and game id, a `uplay://` URL. When Steam will
 * not say what is in the field, writing to it replaces those arguments with a
 * guess and the game stops starting, so the field is left alone and the user
 * is told to set the override by hand. A Steam game cannot lose anything this
 * way: its options are extras, never the command that starts it.
 */
export function safeLaunchWrite(
  appid: string | number | null,
  current: string | null,
  desired: string | null,
): string | null {
  if (current !== null || !isShortcutAppid(appid)) return desired;
  return null;
}

/**
 * What the user can be offered when OptiScaler is removed, best answer first.
 *
 * "Put back what was there" is only offered when there was something — which is
 * exactly the condition the question is worth asking under. Clearing is offered
 * whenever the result is known: the record says the game had no launch options
 * at all, or the override we installed is visibly in what Steam reports.
 *
 * When neither is true, nothing here is known to be ours — and the honest
 * answer used to be to offer nothing, which is how a client build with no way
 * to read launch options turned this whole feature into a dialog that did
 * nothing. Clearing is offered even then, last and never as the default, and
 * says plainly that it empties the field rather than pruning it. Doing nothing
 * has to be a choice the user makes, not one made for them by a missing API.
 *
 * Two choices that would produce the same launch options are collapsed into
 * one, because a dialog offering the same outcome twice is one nobody can
 * answer.
 */
export function launchChoices(state: LaunchState): LaunchChoice[] {
  const { current, recorded, filename } = state;
  const restore: LaunchChoice[] =
    recorded !== null && recorded.trim() !== "" && recorded !== current
      ? [{
          action: "restore",
          label: "Put back what was there before",
          description: recorded,
          value: recorded,
        }]
      : [];

  const keep: LaunchChoice = {
    action: "keep",
    label: "Leave them as they are",
    description: current
      ? `Steam keeps passing: ${current}`
      : "Nothing in Steam is changed.",
    value: null,
  };

  // What removing our half would leave behind, when that is knowable.
  const known =
    recorded === ""
      ? ""
      : current !== null && hasOverride(current, filename)
        ? stripOverride(current, filename)
        : null;
  const blind = known === null && current === null;

  if (known === null && !blind) return [...restore, keep];

  const cleared = known ?? "";
  const clear: LaunchChoice = {
    action: "clear",
    label:
      blind
        ? "Clear the launch options"
        : cleared === ""
          ? "Clear the launch options"
          : "Remove only the OptiScaler override",
    description: blind
      ? `Steam would not report this game's launch options, so this empties the field
         completely — including anything you added yourself.`
      : cleared === ""
        ? recorded === ""
          ? "This game had none before OptiScaler was installed."
          : "Leaves the launch options empty."
        : `Leaves: ${cleared}`,
    value: cleared,
  };

  // A choice that would write back what Steam already has, or that lands on
  // the same string as one already on offer, is not a choice.
  const duplicate =
    cleared === current || restore.some((choice) => choice.value === cleared);
  if (duplicate) return [...restore, keep];
  // Blind clearing is a guess, so it never leads — the safe answer does.
  return blind ? [...restore, keep, clear] : [...restore, clear, keep];
}

/**
 * The choice to act on, honouring a remembered answer only if it still applies.
 *
 * Undefined when there is nothing to choose between — a game Steam does not
 * own, which has no launch options to decide about at all.
 */
export function resolveChoice(
  choices: LaunchChoice[],
  remembered: LaunchAction | null,
): LaunchChoice | undefined {
  const match = remembered && choices.find((choice) => choice.action === remembered);
  return match || choices[0];
}

/** Whether the removal dialog has anything to ask about at all. */
export function hasLaunchQuestion(appid: string | null, state: LaunchState): boolean {
  if (!appid) return false;
  return launchChoices(state).some((choice) => choice.action !== "keep");
}

/** The record as the backend reports it, as the nullable string the UI reasons in. */
export function recordedValue(record: LaunchRecord | undefined): string | null {
  return record?.recorded ? record.value : null;
}

/**
 * What Steam passes this game right now, from whichever source can say.
 *
 * The client is asked first because it is live; Steam only flushes its config
 * file periodically, so a value written seconds ago may not be in it yet. But
 * the client getter is missing from some builds entirely, and on those this
 * was the single point of failure that made the whole feature inert — the
 * plugin could see neither its own override nor anything it had replaced.
 */
export async function currentLaunchOptions(appid: string | null): Promise<string | null> {
  if (!appid) return null;
  const fromClient = await readLaunchOptions(Number(appid));
  if (fromClient !== null) return fromClient;
  try {
    const found = await getLaunchOptions(appid);
    return found.found ? found.value : null;
  } catch {
    return null;
  }
}

/**
 * Keep this game's launch options as they were, before we write our own.
 *
 * Called after a successful install and before the override is set, which is
 * the only moment Steam still holds the answer. Write-once in the backend, so
 * calling it again — a reinstall, or the checklist's launch-options toggle
 * being switched back on — cannot overwrite the original with our own override.
 *
 * What the client reads is passed along rather than looked up again in the
 * backend, because it is the fresher of the two; `null` tells the backend to
 * fall back to Steam's config file instead of recording a value nobody read.
 */
export async function recordPreviousLaunchOptions(
  appid: string | null,
  targetDir: string,
): Promise<void> {
  if (!appid) return;
  const current = await readLaunchOptions(Number(appid));
  try {
    await recordLaunchOptions(targetDir, current, appid);
  } catch {
    /* the record is a convenience; failing to write it must not fail an install */
  }
}
