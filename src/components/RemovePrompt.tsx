import { ConfirmModal, DropdownItem, ToggleField } from "@decky/ui";
import { useState } from "react";
import { launchChoices, resolveChoice } from "../launchOptions";
import type { LaunchAction, LaunchState } from "../launchOptions";
import { Mono, Notice } from "./Common";
import { lang, plural, t } from "../i18n";

/**
 * The question removing OptiScaler has always had and never asked.
 *
 * Installing writes a `WINEDLLOVERRIDES` entry into Steam; removing used to
 * clear it, but only when the plugin could still read the field, and never
 * considered that the game might have had launch options of its own first —
 * which it then destroyed. Both halves are now decisions rather than side
 * effects, and the choice is made from what was actually recorded at install
 * time: "put back what was there" is only offered when there was something.
 *
 * The answer can be remembered, because most people set every game up the same
 * way and being asked each time is the same nag twice. A remembered answer is
 * shown here rather than applied invisibly, and the Settings tab is where it is
 * taken back.
 */
export function RemovePrompt({
  gameName,
  filename,
  backedUp,
  launch,
  remembered,
  canRemember,
  closeModal,
  onConfirm,
}: Readonly<{
  gameName: string;
  filename: string | null;
  backedUp: number;
  /** Null when this game has no launch options to decide about at all. */
  launch: LaunchState | null;
  remembered: LaunchAction | null;
  canRemember: boolean;
  closeModal?: () => void;
  onConfirm: (action: LaunchAction, remember: boolean) => void;
}>) {
  const choices = launch ? launchChoices(launch) : [];
  const asked = choices.filter((choice) => choice.action !== "keep").length > 0;
  const initial = resolveChoice(choices, remembered);
  const [action, setAction] = useState<LaunchAction>(initial?.action ?? "keep");
  const [remember, setRemember] = useState(false);
  const chosen = choices.find((choice) => choice.action === action) ?? initial;

  return (
    <ConfirmModal
      strTitle={t("Remove OptiScaler?")}
      strOKButtonText={t("Remove")}
      strCancelButtonText={t("Keep it")}
      closeModal={closeModal}
      onOK={() => onConfirm(action, remember)}
    >
      <div style={{ fontSize: "14px", lineHeight: 1.5 }}>
        {backedUp > 0
          ? t("The {0} {1} it set aside in {2} are put back, and its settings are removed.", [
              backedUp,
              lang() === "pl"
                ? plural(backedUp, "plik, który odłożył", "pliki, które odłożył", "plików, które odłożył")
                : backedUp === 1
                  ? "file"
                  : "files",
              gameName,
            ])
          : t("Its files and settings are removed from {0}'s folder.", [gameName])}
        {filename ? (
          <>
            {" "}
            <Mono>{filename}</Mono>{t(" goes with them.")}
          </>
        ) : null}
      </div>

      {asked && remembered ? (
        <Notice tone="info" title={t("Steam launch options")}>
          {chosen?.label}{t(". This is the answer you asked to be remembered — change it under ")}
          {t("Settings on the main page.")}
        </Notice>
      ) : null}

      {asked && !remembered ? (
        <>
          <DropdownItem
            label={t("Steam launch options")}
            description={chosen?.description}
            rgOptions={choices.map((choice) => ({ data: choice.action, label: choice.label }))}
            selectedOption={action}
            bottomSeparator="none"
            onChange={(option: { data: LaunchAction }) => setAction(option.data)}
          />
          {canRemember ? (
            <ToggleField
              label={t("Remember my choice")}
              description={t("Later removals do this without asking.")}
              checked={remember}
              bottomSeparator="none"
              onChange={setRemember}
            />
          ) : null}
        </>
      ) : null}

      {!asked ? (
        <div style={{ fontSize: "13px", opacity: 0.7, marginTop: "6px" }}>
          {t("Steam has no launch options for this game to put back.")}
        </div>
      ) : null}
    </ConfirmModal>
  );
}
