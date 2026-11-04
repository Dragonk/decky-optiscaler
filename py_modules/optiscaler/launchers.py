"""Resolution of non-Steam launcher shortcuts to the games they launch.

NonSteamLaunchers adds every store launcher — Epic, Battle.net, Ubisoft, EA,
Amazon, GOG — to Steam as a shortcut whose target is the *launcher's* own
executable inside that launcher's Proton prefix, with the game selected by a
URL argument in the launch options (``com.epicgames.launcher://apps/<AppName>``
for Epic). Managing OptiScaler in the launcher's own folder hooks the
launcher's UI — harmless at best and an assertion dialog at worst — while the
game, which lives elsewhere in the same prefix, gets nothing.

This module resolves such a shortcut to a folder that actually holds games:

* Epic is exact. The launcher keeps a JSON manifest per installed game under
  ``<prefix>/pfx/drive_c/ProgramData/Epic/EpicGamesLauncher/Data/Manifests``,
  and the AppName in the launch options identifies the entry. InstallLocation
  from the manifest is the game folder, and the existing executable scoring
  then finds the shipping binary inside it.
* Every other launcher gets the first of its prefix's known game-install
  roots that exists (``Program Files/Epic Games``-style locations), with the
  prefix's ``drive_c`` as the fallback. Scoring ranks the real game
  executables above anything else, and the launcher binaries themselves are
  blacklisted, so OptiScaler never hooks a launcher UI again. The user can
  always override the pick in the UI.

Failures are silent on purpose: anything this module cannot say with
confidence falls back to the plain shortcut handling.
"""

import json
import re
from pathlib import Path
from urllib.parse import unquote

# The executables that mean "the target is a launcher, not the game".
LAUNCHER_EXES = {
    "epicgameslauncher.exe": "epic",
    "epicgamesupdater.exe": "epic",
    "battle.net.exe": "battlenet",
    "battle.net launcher.exe": "battlenet",
    "ubisoftconnect.exe": "ubisoft",
    "ubisoftconnectinstaller.exe": "ubisoft",
    "uplay.exe": "ubisoft",
    "eadesktop.exe": "ea",
    "ealauncher.exe": "ea",
    "origin.exe": "ea",
    "amazon games.exe": "amazon",
    "amazon games launcher.exe": "amazon",
    "galaxy.exe": "gog",
}

# The URL schemes the launchers use to say which game to start. Only Epic's
# names the game in a form a manifest on disk can be matched against.
EPIC_APP_URI = re.compile(r"com\.epicgames\.launcher://apps/([^?'\"&\s]+)")
LAUNCHER_URIS = (
    "com.epicgames.launcher://",
    "bnet://",
    "uplay://",
    "origin2://",
    "origin://",
    "amazon-games://",
    "gog://",
)

# Where each launcher's prefix keeps installed games, relative to drive_c.
# First one that exists wins; drive_c itself is the fallback.
LAUNCHER_GAME_ROOTS = {
    "epic": ["Program Files/Epic Games", "Program Files (x86)/Epic Games",
             "Program Files"],
    "battlenet": ["Program Files (x86)", "Program Files"],
    "ubisoft": ["Program Files (x86)/Ubisoft", "Program Files/Ubisoft",
                "Program Files (x86)"],
    "ea": ["Program Files/EA Games", "Program Files (x86)/Origin Games",
           "Program Files (x86)/EA Games", "Program Files (x86)"],
    "amazon": ["Program Files/Amazon Games",
               "Program Files (x86)/Amazon Games", "Program Files"],
    "gog": ["Program Files (x86)/GOG Galaxy/Games",
            "Program Files/GOG Galaxy/Games", "Program Files (x86)"],
}

EPIC_MANIFESTS = "ProgramData/Epic/EpicGamesLauncher/Data/Manifests"


def _prefix_drive_c(path):
    """The drive_c of the Proton prefix a path sits inside, or None."""
    if not path:
        return None
    try:
        parts = Path(path).resolve().parts
    except OSError:
        return None
    for i in range(len(parts) - 3):
        if parts[i] == "compatdata" and parts[i + 2] == "pfx":
            drive_c = Path(*parts[:i + 3]) / "drive_c"
            if drive_c.is_dir():
                return drive_c
    return None


def _windows_path(location, drive_c):
    """``C:\\Program Files\\X`` mapped into the prefix's drive_c."""
    text = (location or "").replace("\\\\", "/").strip()
    parts = [p for p in text.split("/") if p]
    if parts and len(parts[0]) == 2 and parts[0][1] == ":":
        parts = parts[1:]
    if not parts:
        return None
    return drive_c.joinpath(*parts)


def _epic_games(drive_c):
    """[(app_name, display_name, install_dir)] for one Epic prefix."""
    out = []
    manifests = drive_c / EPIC_MANIFESTS
    if not manifests.is_dir():
        return out
    try:
        files = sorted(manifests.glob("*.item"))
    except OSError:
        return out
    for item in files:
        try:
            data = json.loads(item.read_text(encoding="utf-8", errors="replace"))
        except (OSError, ValueError):
            continue
        app_name = data.get("AppName")
        location = data.get("InstallLocation")
        if not app_name or not location:
            continue
        install = _windows_path(location, drive_c)
        if install and install.is_dir():
            out.append((app_name, data.get("DisplayName") or app_name, install))
    return out


def _game_root(launcher, drive_c):
    for rel in LAUNCHER_GAME_ROOTS.get(launcher, []):
        candidate = drive_c.joinpath(*Path(rel).parts)
        if candidate.is_dir():
            return candidate
    return drive_c if drive_c.is_dir() else None


def resolve_shortcut(exe, start_dir=None, options="", name=None):
    """The game folder a launcher shortcut launches, or None.

    A shortcut counts as a launcher shortcut when its target is one of the
    known launcher executables or its launch options carry a launcher's URL
    scheme. The launcher's Proton prefix is derived from the target (the
    start directory is the fallback); a shortcut that lives outside any
    prefix is left alone, because there is nothing here to scan safely.
    """
    exe_name = Path(exe).name.lower() if exe else ""
    options = options or ""
    launcher = LAUNCHER_EXES.get(exe_name)
    if launcher is None:
        for uri in LAUNCHER_URIS:
            if uri in options:
                launcher = "epic" if "com.epicgames.launcher://" in options else "generic"
                break
    if launcher is None:
        return None

    drive_c = _prefix_drive_c(exe) or _prefix_drive_c(start_dir)
    if drive_c is None:
        return None

    if launcher == "epic":
        match = EPIC_APP_URI.search(options)
        games = _epic_games(drive_c)
        if match:
            wanted = unquote(match.group(1))
            for app_name, display, install in games:
                if app_name == wanted:
                    return {"name": display, "path": str(install),
                            "source": "epic"}
        # The URL names a game the launcher cannot see (uninstalled, or its
        # manifest unreadable); scanning the prefix's install root still
        # gives the UI something to work with.

    root = _game_root(launcher if launcher != "generic" else "epic", drive_c)
    if root is None:
        return None
    return {"name": name or root.name, "path": str(root),
            "source": f"{launcher}-prefix" if launcher != "generic" else "launcher-prefix"}
