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
import os
import re
import tempfile
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


def _case_child(folder, wanted):
    """The child of *folder* matching *wanted*, case-insensitively as a fallback.

    Windows paths do not care about case; the filesystem the game sits on
    does, and the state file spells the executable the way the game's own
    manifest does -- not always the spelling the folders on disk carry.
    """
    candidate = folder / wanted
    if candidate.exists():
        return candidate
    wanted = wanted.lower()
    try:
        entries = list(folder.iterdir())
    except OSError:
        return None
    for entry in entries:
        if entry.name.lower() == wanted and entry.is_dir():
            return entry
    return None


def _xodus_exe_dir(folder, executable):
    """The folder a Xodus game's executable runs from, or None.

    The state file names the executable the way the game's own manifest
    does, with Windows separators -- and that folder is where OptiScaler
    has to sit. An installed package keeps its executable as an encrypted
    blob no folder scan can find, while the folder the state names is the
    one the launch view puts it in, decrypted, when the game runs.
    """
    if not isinstance(executable, str) or not executable.strip():
        return None
    relative = executable.replace(chr(92), "/").strip().strip("/")
    parts = [part for part in relative.split("/") if part not in ("", ".")]
    if not parts or ".." in parts:
        return None
    current = Path(folder)
    for part in parts[:-1]:
        current = _case_child(current, part)
        if current is None:
            return None
    return current if current.is_dir() else None


def _xodus_game(data, game_id, name=None):
    """The installed game a 16-hex shortcut id names, from the state file.

    When the state names the game's executable, the folder that
    executable runs from is the one to manage: it is where OptiScaler has
    to sit, and for an installed package it is the only place that
    folder can be learned from at all. Without it the install folder
    answers, as before.
    """
    for game in data.get("games") or []:
        if not isinstance(game, dict) or game.get("id") != game_id:
            continue
        folder = game.get("path")
        if folder and Path(folder).is_dir():
            exe_dir = _xodus_exe_dir(folder, game.get("executable"))
            return {"name": game.get("title") or name or "Xodus Nexus game",
                    "path": str(exe_dir or folder), "source": "xodus"}
    return None


def _shortcut_command(exe, options):
    """Everything a shortcut says it runs, as one command line.

    The launch line can arrive in either field: Xodus's own writer puts
    the script it runs in the launch options, while the shortcut Steam
    imports from Xodus's .desktop file keeps the whole Exec line in the
    target field and leaves the launch options empty -- a shortcut has
    to be read as one line to resolve either way.
    """
    return " ".join(part for part in (options or "", exe or "") if part)


def _xodus_shortcut(command, name=None):
    """The install folder a Xodus Nexus shortcut's game lives in, or None.

    *command* is the whole line the shortcut runs: the script and the
    game id can sit in the launch options or, after Steam's .desktop
    import, in the target field alone.
    """
    match = XODUS_SHORTCUT.search(command)
    if match:
        data = _xodus_state(match.group(1))
        if data is None:
            return None
        if match.group(2) == "game":
            ids = XODUS_GAME_ID.findall(command.replace(match.group(1), " "))
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
    direct = XODUS_DIRECT.search(command)
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
    command = _shortcut_command(exe, options)
    if LAUNCHER_EXES.get(exe_name):
        return True
    if XODUS_SHORTCUT.search(command) or XODUS_DIRECT.search(command):
        return True
    return any(uri in command for uri in LAUNCHER_URIS)


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
    command = _shortcut_command(exe, options)
    # Xodus Nexus first: it is native Linux, so there is no prefix at all and
    # its own state file says exactly where the game is. The whole line is
    # searched: Steam's .desktop import leaves the launch line in the
    # target field, not the launch options.
    xodus = _xodus_shortcut(command, name)
    if xodus is not None:
        return xodus
    launcher = LAUNCHER_EXES.get(exe_name)
    if launcher is None:
        for uri in LAUNCHER_URIS:
            if uri in command:
                launcher = "epic" if "com.epicgames.launcher://" in command else "generic"
                break
    if launcher is None:
        return None

    drive_c = _prefix_drive_c(exe) or _prefix_drive_c(start_dir)
    if drive_c is None:
        return None

    if launcher == "epic":
        match = EPIC_APP_URI.search(command)
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
CHAIN_VIEW_PREFIXES = (".xodus-chain-", ".xodus-offline-", "xodus-chain-")

# The files an OptiScaler install can put in a game folder, under any of the
# proxy names the wiki allows. A view carrying none of these cannot load
# OptiScaler, whatever the launch options say.
CHAIN_VIEW_MARKERS = (
    "dxgi.dll", "version.dll", "winmm.dll", "d3d12.dll", "dinput8.dll",
    "OptiScaler.ini", "optiscaler.ini",
    # Where the live-control module itself lands once it is installed.
    "OptiScaler/plugins/decky_optiscaler_live.asi",
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

    The backend materializes a view next to the game's root folder, and the
    panel's target may be the executable's folder several levels below it,
    so every ancestor is asked and each view is reported with the folder
    inside it that mirrors the target. Only views that mirror the folder
    they sit beside are reported -- a neighbour game's view links
    elsewhere -- and views are removed when the launch ends, so an empty
    report means either "this game does not use one" or "the game is not
    running"; what is reported is read as found, while the game runs.
    """
    game = Path(game_dir)
    scanned = []
    node = game
    for _level in range(5):
        if not node.is_dir():
            break
        if node.parent.is_dir() and str(node.parent) not in scanned:
            scanned.append(str(node.parent))
        if node == node.parent:
            break
        node = node.parent
    for temp_root in _temp_view_roots():
        if str(temp_root) not in scanned:
            scanned.append(str(temp_root))
    views = []
    for view, inside in launch_views_around(game_dir):
        entry = {
            "name": view.name,
            "path": str(view),
            "inside": str(inside),
            "files": [],
            "markers": {},
            "targets": {},
        }
        try:
            names = sorted(child.name for child in inside.iterdir())
        except OSError:
            names = []
        entry["files"] = names[:40]
        for marker in CHAIN_VIEW_MARKERS:
            state = _marker_state(inside / marker)
            entry["markers"][marker] = state
            if state == "link":
                try:
                    entry["targets"][marker] = str((inside / marker).readlink())
                except OSError:
                    entry["targets"][marker] = None
        views.append(entry)
    game_markers = {
        marker: _marker_state(game / marker) for marker in CHAIN_VIEW_MARKERS
    }
    return {"views": views, "game_markers": game_markers, "scanned": scanned}


def _view_mirrors(inside, node):
    """Whether a launch view folder mirrors the game folder *node*.

    The backend symlinks the game's own files into the view, so a view
    belongs to this game when something in it links back into the folder
    it mirrors. Decrypted executables are real files and a neighbour
    game's view links elsewhere, so this is what tells them apart.
    """
    try:
        resolved_node = node.resolve()
        entries = list(inside.iterdir())
    except OSError:
        return False
    for entry in entries:
        try:
            if entry.is_symlink():
                target = entry.resolve()
                if target == resolved_node or resolved_node in target.parents:
                    return True
        except OSError:
            continue
    return False


def _temp_view_roots():
    """The directories a launch view falls back to.

    A game installed on a filesystem that cannot hold the view -- one that
    refuses private permissions or symlinks -- gets its view in the
    system's temporary directory instead, without the dot in the prefix.
    """
    roots = [Path(tempfile.gettempdir())]
    if "/tmp" not in [str(root) for root in roots]:
        roots.append(Path("/tmp"))
    return roots


def _mirrored_root(view):
    """The game folder a fallback view mirrors, from what it links to.

    A fallback view sits in the temporary directory, not next to the
    folder it mirrors, so the only thing that can name that folder is the
    view itself: the backend symlinks the game's own files into it, and
    the folders those links come from share the one they mirror.
    """
    parents = []
    try:
        entries = list(view.iterdir())
    except OSError:
        return None
    for entry in entries:
        try:
            if entry.is_symlink():
                parents.append(entry.resolve().parent)
        except OSError:
            continue
    if not parents:
        return None
    try:
        return Path(os.path.commonpath([str(parent) for parent in parents]))
    except ValueError:
        return None


def launch_views_around(target_dir, depth=4, temp_roots=None):
    """The Xodus launch views a running game may have started from.

    A view is created next to the folder the backend was told the game
    lives in -- the game's root -- while the panel's target may be the
    folder of the game's executable, several levels below it. So every
    ancestor of the target is asked, up to *depth* levels up, and each
    view is returned with the folder inside it that mirrors the target.
    Only views mirroring the folder they sit beside are returned.

    When the game's own filesystem cannot hold the view, the backend
    falls back to the system's temporary directory, so those are asked
    too -- a view there is only taken when the game's own files link
    into it, which is what names the folder it mirrors. A view exists
    only while its game runs, so this is asked fresh every time.
    """
    target = Path(target_dir)
    found = []
    node = target
    for _level in range(depth + 1):
        if not node.is_dir():
            break
        parent = node.parent
        if parent.is_dir():
            try:
                entries = sorted(parent.iterdir(), key=lambda item: item.name)
            except OSError:
                entries = []
            for entry in entries:
                if not entry.name.startswith(CHAIN_VIEW_PREFIXES):
                    continue
                if not entry.is_dir():
                    continue
                inside = entry / target.relative_to(node)
                if not inside.is_dir():
                    continue
                if not _view_mirrors(inside, node):
                    continue
                found.append((entry, inside))
        if node == node.parent:
            break
        node = parent
    roots = _temp_view_roots() if temp_roots is None else [Path(root) for root in temp_roots]
    for temp_root in roots:
        try:
            entries = sorted(temp_root.iterdir(), key=lambda item: item.name)
        except OSError:
            continue
        for entry in entries:
            if not entry.name.startswith(CHAIN_VIEW_PREFIXES):
                continue
            if not entry.is_dir():
                continue
            if any(entry == view for view, _inside in found):
                continue
            mirrored = _mirrored_root(entry)
            if mirrored is None:
                continue
            try:
                inside = entry / target.relative_to(mirrored)
            except ValueError:
                continue
            if not inside.is_dir():
                continue
            found.append((entry, inside))
    return found

