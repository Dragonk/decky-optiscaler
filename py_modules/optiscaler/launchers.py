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
* Xodus Nexus — renamed **Nexus Launcher** in 0.5 — is none of the above: a
  native Linux AppImage, so there is no Proton prefix and no drive_c. Its
  Steam shortcuts are ``/bin/sh`` wrappers around a script the launcher
  generates (``<profile>/shortcuts/launch-game <16-hex id>``), and the
  folder each game is installed in is recorded in the launcher's own
  ``launcher-state.json``, next to that script. The id is matched against
  that file exactly, like Epic's manifests; the launcher's own shortcut
  resolves to the folder Nexus installs games into.

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

# Xodus Nexus / Nexus Launcher: a native Linux launcher, so its shortcut is
# /bin/sh running a script it generated, with the game named by a 16-hex id.
XODUS_SHORTCUT = re.compile(r"([^\s'\"]*shortcuts/launch-(game|nexus))")
XODUS_DIRECT = re.compile(r"--launch-game\s+['\"]?([0-9a-f]{16})")
XODUS_GAME_ID = re.compile(r"\b([0-9a-f]{16})\b")
XODUS_STATE = "launcher-state.json"
XODUS_DEFAULT_SCRIPT = Path(".config") / "xodus-nexus" / "shortcuts" / "launch-game"

# Where each launcher's prefix keeps installed games, relative to drive_c.
# First one that exists wins; drive_c itself is the fallback.
LAUNCHER_GAME_ROOTS = {
    "epic": ["Program Files/Epic Games", "Program Files (x86)/Epic Games",
             "Program Files"],
    "battlenet": ["Program Files (x86)", "Program Files"],
    "ubisoft": ["Program Files (x86)/Ubisoft/Ubisoft Game Launcher/games",
                "Program Files/Ubisoft/Ubisoft Game Launcher/games",
                "Program Files (x86)/Ubisoft", "Program Files/Ubisoft",
                "Program Files (x86)"],
    "ea": ["Program Files/EA Games", "Program Files (x86)/Origin Games",
           "Program Files (x86)/EA Games", "Program Files (x86)"],
    "amazon": ["Program Files/Amazon Games/Library",
               "Program Files (x86)/Amazon Games/Library",
               "Program Files/Amazon Games",
               "Program Files (x86)/Amazon Games", "Program Files"],
    "gog": ["Program Files (x86)/GOG Galaxy/Games",
            "Program Files/GOG Galaxy/Games",
            "Program Files (x86)/GOG Games", "GOG Games",
            "Program Files (x86)"],
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
    text = (location or "").replace("\\", "/").strip()
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


def _xodus_state(script):
    """The parsed launcher-state.json of the profile a launch script belongs to."""
    state = Path(script).parent.parent / XODUS_STATE
    try:
        data = json.loads(state.read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _xodus_game(data, game_id, name=None):
    """The installed game a 16-hex shortcut id names, from the state file."""
    for game in data.get("games") or []:
        if not isinstance(game, dict) or game.get("id") != game_id:
            continue
        folder = game.get("path")
        if folder and Path(folder).is_dir():
            return {"name": game.get("title") or name or "Xodus Nexus game",
                    "path": str(folder), "source": "xodus"}
    return None


def _xodus_shortcut(options, name=None):
    """The install folder a Xodus Nexus shortcut's game lives in, or None."""
    match = XODUS_SHORTCUT.search(options)
    if match:
        data = _xodus_state(match.group(1))
        if data is None:
            return None
        if match.group(2) == "game":
            ids = XODUS_GAME_ID.findall(options.replace(match.group(1), " "))
            return _xodus_game(data, ids[-1], name) if ids else None
        # The launcher's own shortcut: the folder Nexus installs games into,
        # so the UI has something better than /bin to point at.
        root = (data.get("settings") or {}).get("installRoot")
        if root and Path(root).is_dir():
            return {"name": name or "Xodus Nexus", "path": str(root),
                    "source": "xodus-launcher"}
        return None
    # A shortcut that calls the AppImage with --launch-game itself — the way a
    # tool other than Nexus wires it up. Without the script's path the default
    # profile is the only place the state can be.
    direct = XODUS_DIRECT.search(options)
    if direct:
        data = _xodus_state(Path.home() / XODUS_DEFAULT_SCRIPT)
        if data is not None:
            return _xodus_game(data, direct.group(1), name)
    return None


def is_launcher_shortcut(exe=None, options=""):
    """Whether a shortcut is one of the launchers' wrappers, not a game.

    Every shortcut NonSteamLaunchers adds for a store launcher, and every one
    Xodus Nexus generates for itself, runs the launcher rather than the game,
    so the folder its target sits in is the one folder it must never be
    resolved to. This is what lets the caller refuse the plain fallback when
    resolution came back empty, instead of installing OptiScaler next to the
    launcher's own UI.
    """
    exe_name = Path(exe).name.lower() if exe else ""
    options = options or ""
    if LAUNCHER_EXES.get(exe_name):
        return True
    if XODUS_SHORTCUT.search(options) or XODUS_DIRECT.search(options):
        return True
    return any(uri in options for uri in LAUNCHER_URIS)


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
    # Xodus Nexus first: it is native Linux, so there is no prefix at all and
    # its own state file says exactly where the game is.
    xodus = _xodus_shortcut(options, name)
    if xodus is not None:
        return xodus
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


# Xodus launches encrypted games out of a temporary "chain view" it materializes
# next to the install. The prefixes are the ones its runtime accepts in a launch
# path; both spellings occur in the wild.
CHAIN_VIEW_PREFIXES = (".xodus-chain-", "xodus-chain-")

# The files an OptiScaler install can put in a game folder, under any of the
# proxy names the wiki allows. A view carrying none of these cannot load
# OptiScaler, whatever the launch options say.
CHAIN_VIEW_MARKERS = (
    "dxgi.dll", "version.dll", "winmm.dll", "d3d12.dll", "dinput8.dll",
    "OptiScaler.ini", "optiscaler.ini",
)


def _marker_state(path):
    """A marker file's state in one word: link, file, or None."""
    try:
        if path.is_symlink():
            return "link"
        if path.is_file():
            return "file"
    except OSError:
        return None
    return None


def probe_chain_views(game_dir):
    """Report the Xodus Nexus launch views that exist around a game folder.

    Xodus's backend is closed, and the chain view it materializes per launch is
    the directory the game's executable actually runs from -- so whether a
    file this plugin installed after the fact was linked into it is what
    decides whether OptiScaler can load at all in an encrypted game. Nothing
    here can assume the answer: the views are read as found, while the game
    runs, and each is reported with the OptiScaler files it carries, where
    they link to, and a listing for the panel to show.

    Views live in the root Xodus installs games into -- the game folder's
    parent -- and are removed when the launch ends, so an empty report means
    either "this game does not use one" or "the game is not running"; the
    game folder itself is scanned too, because a view could in principle be
    placed anywhere its runtime still accepts it.
    """
    game = Path(game_dir)
    scanned = []
    views = []
    for root in (game.parent, game):
        if not root.is_dir():
            continue
        try:
            entries = sorted(root.iterdir(), key=lambda item: item.name)
        except OSError:
            continue
        scanned.append(str(root))
        for entry in entries:
            if not entry.name.startswith(CHAIN_VIEW_PREFIXES):
                continue
            if not entry.is_dir():
                continue
            view = {
                "name": entry.name,
                "path": str(entry),
                "files": [],
                "markers": {},
                "targets": {},
            }
            try:
                names = sorted(child.name for child in entry.iterdir())
            except OSError:
                names = []
            view["files"] = names[:40]
            for marker in CHAIN_VIEW_MARKERS:
                state = _marker_state(entry / marker)
                view["markers"][marker] = state
                if state == "link":
                    try:
                        view["targets"][marker] = str((entry / marker).readlink())
                    except OSError:
                        view["targets"][marker] = None
            views.append(view)
    game_markers = {
        marker: _marker_state(game / marker) for marker in CHAIN_VIEW_MARKERS
    }
    return {"views": views, "game_markers": game_markers, "scanned": scanned}

