import {
  ButtonItem,
  ConfirmModal,
  DropdownItem,
  Focusable,
  PanelSection,
  PanelSectionRow,
  ToggleField,
  showModal,
} from "@decky/ui";
import { toaster } from "@decky/api";
import { useEffect, useState } from "react";
import { install, setGameTarget, setWikiEntry } from "../api";
import { setLaunchOptions } from "../hooks/useRunningGame";
import {
  currentLaunchOptions,
  launchOptionFor,
  mergeLaunchOptions,
  recordPreviousLaunchOptions,
  safeLaunchWrite,
} from "../launchOptions";
import { PREF_INSTALL_LAUNCH, isRemembering, recall, remember } from "../prefs";
import { useAutoPlan } from "../hooks/useAutoPlan";
import type { GameDetail, LiveStatus, PayloadStatus } from "../types";
import { KeyValue, Mono, Notice, Pill } from "./Common";
import { Fsr4Panel } from "./Fsr4Panel";
import { LivePanel } from "./LivePanel";
import { OptipatcherPanel } from "./OptipatcherPanel";
import { WikiSearch } from "./WikiSearch";
import { t } from "../i18n";

interface Props {
  detail: GameDetail;
  status: PayloadStatus | null;
  appid: string | null;
  live: LiveStatus | null;
  onChanged: () => Promise<void> | void;
}

/**
 * Asked once, right after an install that needs it.
 *
 * Without the override Proton loads its own copy of the DLL and OptiScaler
 * never runs at all, so this is the difference between an install that works
 * and one that silently does nothing — worth interrupting for, but not worth
 * asking twice, hence "Remember my choice".
 */
function LaunchOptionsPrompt({
  filename,
  launchOption,
  canRemember,
  closeModal,
  onDecide,
}: Readonly<{
  filename: string;
  launchOption: string;
  /** False once the user has turned remembering off under Settings. */
  canRemember: boolean;
  closeModal?: () => void;
  onDecide: (apply: boolean, remember: boolean) => void;
}>) {
  const [rememberIt, setRememberIt] = useState(false);
  return (
    <ConfirmModal
      strTitle={t("Set the Steam launch options?")}
      strOKButtonText={t("Set them for me")}
      strCancelButtonText={t("Not now")}
      closeModal={closeModal}
      onOK={() => onDecide(true, rememberIt)}
      onCancel={() => onDecide(false, rememberIt)}
    >
      <div style={{ fontSize: "14px", lineHeight: 1.5 }}>
        {t("Proton loads its own")} <Mono>{filename}</Mono>{t(" unless this override is set, and")}
        {t(" OptiScaler never gets to run:")}
        <div style={{ margin: "8px 0" }}>
          <Mono>{launchOption}</Mono>
        </div>
      </div>
      {canRemember ? (
        <ToggleField
          label={t("Remember my choice")}
          checked={rememberIt}
          bottomSeparator="none"
          onChange={setRememberIt}
        />
      ) : null}
    </ConfirmModal>
  );
}

/**
 * Everything about one install that is not the three steps: which file name,
 * which folder, OptiPatcher, FSR 4 files, the wiki entry to follow and the
 * launch options. Reached from "Manual setup" on the setup checklist,
 * which is where the majority of games never have to come.
 */
export function InstallPanel({ detail, status, appid, live, onChanged }: Props) {
  const [filename, setFilename] = useState(detail.install.filename ?? "dxgi.dll");
  const [target, setTarget] = useState(detail.target);
  const [preserveIni, setPreserveIni] = useState(false);
  const [optipatcher, setOptipatcher] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  /**
   * What Steam is passing right now, or null when no source could say.
   *
   * Stated on the page rather than only used: when the launch options are the
   * half of an install that is not working, "the plugin cannot read them" and
   * "they are empty" look identical from the outside, and telling them apart
   * took a source-code read the last time it mattered.
   */
  const [launchNow, setLaunchNow] = useState<string | null>(null);
  const [launchRead, setLaunchRead] = useState(false);
  const proxies = status?.proxy_filenames ?? ["dxgi.dll"];
  const {
    recommendation,
    loading: loadingWiki,
    reload: lookup,
  } = useAutoPlan(detail.path, detail.name);

  useEffect(() => {
    setTarget(detail.target);
    if (detail.install.filename) setFilename(detail.install.filename);
  }, [detail.target, detail.install.filename]);

  useEffect(() => {
    if (recommendation && !detail.install.installed) setFilename(recommendation.filename);
  }, [recommendation, detail.install.installed]);

  useEffect(() => {
    void (async () => {
      const value = await currentLaunchOptions(appid);
      setLaunchNow(value);
      setLaunchRead(true);
    })();
  }, [appid, detail.install.installed]);

  // An .asi build is loaded by an ASI loader, so Proton has nothing to shadow.
  const needsNoOverride = filename.toLowerCase().endsWith(".asi");
  const launchOption = launchOptionFor(filename);

  const doInstall = async () => {
    setBusy(true);
    try {
      const result = await install(target, filename, preserveIni, optipatcher);
      if (result.ok) {
        toaster.toast({
          title: t("OptiScaler installed"),
          body: t("{0} in {1}", [filename, target.split("/").slice(-2).join("/")]),
        });
        await setGameTarget(detail.path, target);
        // Before anything of ours reaches Steam: what the game was launched
        // with until now is what removing OptiScaler will offer to put back.
        await recordPreviousLaunchOptions(appid, target);
        await onChanged();
        await offerLaunchOptions();
      } else {
        toaster.toast({ title: t("Install failed"), body: String(result.error) });
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * The one thing an install cannot do for itself without being asked.
   * Answered already? Honour that answer and say nothing.
   */
  const offerLaunchOptions = async () => {
    if (!appid || needsNoOverride) return;
    const remembered = await recall(PREF_INSTALL_LAUNCH);
    if (remembered === "never") return;
    if (remembered === "always") {
      applyLaunchOptions();
      return;
    }
    const canRemember = await isRemembering();
    showModal(
      <LaunchOptionsPrompt
        filename={filename}
        launchOption={launchOption}
        canRemember={canRemember}
        onDecide={(apply, rememberIt) => {
          if (rememberIt) void remember(PREF_INSTALL_LAUNCH, apply ? "always" : "never");
          if (apply) applyLaunchOptions();
        }}
      />
    );
  };

  const applyLaunchOptions = async () => {
    if (!appid) return;
    // Merge, not replace: a launcher shortcut's options carry the arguments
    // that start the game, and they must survive our override.
    const current = await currentLaunchOptions(appid);
    const merged = safeLaunchWrite(appid, current, mergeLaunchOptions(current, launchOption));
    if (merged === null) {
      toaster.toast({
        title: t("Launch options not changed"),
        body: t("Steam will not say what this shortcut passes its game, so the field is left alone."),
      });
      return;
    }
    if (setLaunchOptions(Number(appid), merged)) {
      setLaunchNow(merged);
      setLaunchRead(true);
      toaster.toast({ title: t("Launch options set"), body: merged });
    } else {
      toaster.toast({ title: t("Could not set launch options"), body: t("Set them manually in Steam.") });
    }
  };

  return (
    <>
      <PanelSection title={t("Compatibility")}>
        <PanelSectionRow>
          {loadingWiki ? (
            <Notice tone="info">{t("Checking the OptiScaler wiki…")}</Notice>
          ) : recommendation?.matched ? (
            <div style={{ padding: "2px 0" }}>
              <div style={{ marginBottom: "6px" }}>
                <Pill color="#3a6ea5">{recommendation.compatibility ?? "?"}</Pill>
                <Pill>{recommendation.game}</Pill>
                {recommendation.optipatcher ? <Pill color="#5b4a85">{t("OptiPatcher")}</Pill> : null}
              </div>
              <KeyValue
                label={t("Recommended file")}
                value={<Mono>{recommendation.filename}</Mono>}
              />
              <KeyValue label={t("Source")} value={recommendation.filename_source} />
              {recommendation.alternatives.length > 0 ? (
                <KeyValue
                  label={t("Also reported")}
                  value={recommendation.alternatives.join(", ")}
                />
              ) : null}
              {recommendation.inputs ? (
                <KeyValue label={t("Upscaler inputs")} value={recommendation.inputs} />
              ) : null}
              {recommendation.detail?.["FG Inputs"] ? (
                <KeyValue label={t("FG inputs")} value={recommendation.detail["FG Inputs"]} />
              ) : null}
              {recommendation.notes ? (
                <Notice tone="info" title={t("Notes")}>
                  {stripMarkdown(recommendation.notes)}
                </Notice>
              ) : null}
              {recommendation.detail?.["Known Issues"] &&
              recommendation.detail["Known Issues"] !== "-" ? (
                <Notice tone="warn" title={t("Known issues")}>
                  {stripMarkdown(recommendation.detail["Known Issues"])}
                </Notice>
              ) : null}
            </div>
          ) : recommendation && !recommendation.list_available ? (
            <Notice tone="error" title={t("Could not load the compatibility list")}>
              {recommendation.list_meta?.error ?? t("The wiki could not be reached.")}{t(" Check the")}
              {t("network and use “Refresh from wiki”.")}
            </Notice>
          ) : (
            <Notice tone="warn" title={t("No entry matched automatically")}>
              {t("Searched")} {(recommendation?.searched ?? []).map((n) => `“${n}”`).join(t(" and "))}{" "}
              {t("against {0} entries. Pick the game by hand below —", [recommendation?.entry_count ?? 0])}
              {t("OptiScaler still works with most DLSS/FSR2+/XeSS games, and")} <Mono>dxgi.dll</Mono>{" "}
              {t("is the usual choice.")}
            </Notice>
          )}
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={loadingWiki} onClick={() => void lookup(true)}>
            {t("Refresh from wiki")}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => setSearching((value) => !value)}>
            {searching ? t("Hide search") : t("Find this game in the list myself")}
          </ButtonItem>
        </PanelSectionRow>
        {searching ? (
          <WikiSearch
            initialQuery={detail.name}
            current={detail.wiki_entry}
            onPick={async (entryName) => {
              await setWikiEntry(detail.path, entryName);
              setSearching(false);
              await onChanged();
              await lookup(false);
              toaster.toast({ title: t("Compatibility entry set"), body: entryName });
            }}
          />
        ) : null}
      </PanelSection>

      <PanelSection title={detail.install.installed ? t("Installation") : t("Install OptiScaler")}>
        {detail.install.installed ? (
          <PanelSectionRow>
            <div style={{ padding: "2px 0" }}>
              <KeyValue label={t("Installed as")} value={<Mono>{detail.install.filename}</Mono>} />
              <KeyValue label={t("Version")} value={detail.install.version ?? t("unknown build")} />
              <KeyValue
                label={t("Managed by")}
                value={detail.install.managed ? t("this plugin") : t("installed externally")}
              />
              <KeyValue label={t("Folder")} value={<Mono>{shorten(detail.install.path)}</Mono>} />
              {detail.install.backed_up.length > 0 ? (
                <KeyValue
                  label={t("Files set aside")}
                  value={t("{0} in {1}/", [detail.install.backed_up.length, detail.install.backup_dir.split("/").pop()])}
                />
              ) : null}
              {detail.install.extra_proxies.length > 0 ? (
                <Notice tone="warn" title={t("Duplicate OptiScaler copies")}>
                  {t("Also found {0} in this folder. Loading", [detail.install.extra_proxies.join(", ")])}{t(" ")}
                  {t("OptiScaler twice can crash the game — reinstall to clean them up.")}
                </Notice>
              ) : null}
            </div>
          </PanelSectionRow>
        ) : null}

        {detail.candidates.length > 1 ? (
          <PanelSectionRow>
            <DropdownItem
              label={t("Install location")}
              description={t("OptiScaler must sit next to the executable that renders the game.")}
              disabled={busy || detail.install.installed}
              bottomSeparator="standard"
              rgOptions={detail.candidates.map((candidate) => ({
                data: candidate.path,
                label: t("{0} ({1})", [
                  candidate.relative === "." ? t("game root") : candidate.relative,
                  candidate.executables[0] ?? t("no exe"),
                ]),
              }))}
              selectedOption={target}
              onChange={(selected) => setTarget(String(selected.data))}
            />
          </PanelSectionRow>
        ) : null}

        <PanelSectionRow>
          <DropdownItem
            label={t("Filename override")}
            description={t("OptiScaler is installed under this name so the game loads it.")}
            disabled={busy}
            bottomSeparator="standard"
            rgOptions={proxies.map((name) => ({
              data: name,
              label:
                recommendation?.matched && name === recommendation.filename
                  ? t("{0} — recommended", [name])
                  : name,
            }))}
            selectedOption={filename}
            onChange={(selected) => setFilename(String(selected.data))}
          />
        </PanelSectionRow>

        {detail.ini_info?.legacy ? (
          <PanelSectionRow>
            <Notice tone="warn" title={t("Existing config looks out of date")}>
              {t("The OptiScaler.ini already here still uses the old")} <Mono>FGType</Mono>{t(" key, so it")}{t(" ")}
              {t("was written by an older tool. Install with a fresh config unless you know you")}{t(" ")}
              {t("want to keep it.")}
            </Notice>
          </PanelSectionRow>
        ) : null}

        {detail.install.installed ? null : (
          <PanelSectionRow>
            <ToggleField
              label={t("Also install OptiPatcher")}
              description={
                t("Patches supported games so OptiScaler sees their DLSS and DLSS-FG inputs ") +
                t("without spoofing the GPU. Red Dead Redemption 2 is one of the games that ") +
                t("needs it. Harmless on games it has no patterns for.")
              }
              checked={optipatcher}
              disabled={busy}
              bottomSeparator="standard"
              onChange={setOptipatcher}
            />
          </PanelSectionRow>
        )}

        {detail.install.installed ? null : (
          <PanelSectionRow>
            <ToggleField
              label={t("Keep existing OptiScaler.ini")}
              description={t("Preserve settings from a previous install instead of writing a fresh config.")}
              checked={preserveIni}
              disabled={busy}
              bottomSeparator="standard"
              onChange={setPreserveIni}
            />
          </PanelSectionRow>
        )}

        {!detail.install.installed ? (
          <PanelSectionRow>
            <Notice tone="info" title={t("Nothing gets lost")}>
              {t("Any file OptiScaler would overwrite — including DLLs the game ships itself — is")}{t(" ")}
              {t("moved into")} <Mono>decky_optiscaler_backup_files/</Mono>{t(" and put back when you")}
              {t(" uninstall.")}
            </Notice>
          </PanelSectionRow>
        ) : null}

        {!detail.writable ? (
          <PanelSectionRow>
            <Notice tone="error" title={t("Folder is not writable")}>
              <Mono>{shorten(target)}</Mono>
            </Notice>
          </PanelSectionRow>
        ) : null}

        <PanelSectionRow>
          <ButtonItem layout="below" disabled={busy || !detail.writable} onClick={doInstall}>
            {busy
              ? t("Working…")
              : detail.install.installed
                ? detail.install.filename === filename
                  ? t("Reinstall as {0}", [filename])
                  : t("Switch to {0}", [filename])
                : t("Install as {0}", [filename])}
          </ButtonItem>
        </PanelSectionRow>

      </PanelSection>

      {detail.install.installed ? (
        <Fsr4Panel
          targetDir={detail.install.path}
          sources={detail.fsr4_sources ?? []}
          gpu={detail.gpu}
          onChanged={onChanged}
        />
      ) : null}

      {detail.install.installed ? (
        <LivePanel targetDir={detail.install.path} status={live} onChanged={onChanged} />
      ) : null}

      {detail.install.installed ? (
        <OptipatcherPanel targetDir={detail.install.path} />
      ) : null}

      <PanelSection title={t("Steam Launch Options")}>
        <PanelSectionRow>
          <Notice tone={needsNoOverride ? "info" : "warn"}>
            {needsNoOverride ? (
              <>{t("An ")}<Mono>{t(".asi")}</Mono>{t(" build is loaded by an ASI loader and needs no override.")}</>
            ) : (
              <>
                {t("Proton will load its own")} <Mono>{filename}</Mono>{t(" unless you add this override:")}
                <div style={{ marginTop: "6px" }}>
                  <Mono>{launchOption}</Mono>
                </div>
              </>
            )}
          </Notice>
        </PanelSectionRow>
        {appid ? (
          <PanelSectionRow>
            <Focusable
              focusWithinClassName="gpfocuswithin"
              style={{ padding: "2px 0", width: "100%" }}
            >
              <KeyValue
                label={t("Steam is passing")}
                value={
                  !launchRead ? (
                    t("reading…")
                  ) : launchNow === null ? (
                    t("Steam would not say")
                  ) : launchNow === "" ? (
                    t("nothing")
                  ) : (
                    <Mono>{launchNow}</Mono>
                  )
                }
              />
              {/* What removing OptiScaler would be able to put back. Absent on
                  {t("installs made before this was recorded, and on games where no")}
                  source could read the field at the time. */}
              <KeyValue
                label={t("Before the install")}
                value={
                  !detail.install.installed
                    ? "—"
                    : detail.install.launch_record?.recorded
                      ? detail.install.launch_record.value
                        ? <Mono>{detail.install.launch_record.value}</Mono>
                        : t("nothing")
                      : t("not recorded")
                }
              />
            </Focusable>
          </PanelSectionRow>
        ) : null}
        {appid && !needsNoOverride ? (
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={busy} onClick={applyLaunchOptions}>
              {t("Set launch options for me")}
            </ButtonItem>
          </PanelSectionRow>
        ) : null}
        {!appid ? (
          <PanelSectionRow>
            <Focusable style={{ fontSize: "12px", opacity: 0.7, padding: "4px 0" }}>
              {t("This game came from a custom folder, so add the override yourself in whichever")}{t(" ")}
              {t("launcher starts it.")}
            </Focusable>
          </PanelSectionRow>
        ) : null}
      </PanelSection>
    </>
  );
}

function shorten(path: string, keep = 3) {
  const parts = path.split("/").filter(Boolean);
  return parts.length <= keep ? path : `…/${parts.slice(-keep).join("/")}`;
}

/** The wiki cells contain markdown links and AsciiDoc markup. */
function stripMarkdown(text: string) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\+\+\+<\/?s>\+\+\+/g, "")
    .replace(/[`*_]/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .trim();
}
