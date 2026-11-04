# Decky OptiScaler

[![Build](https://github.com/Dragonk/decky-optiscaler/actions/workflows/build.yml/badge.svg)](https://github.com/Dragonk/decky-optiscaler/actions/workflows/build.yml)
[![Latest release](https://img.shields.io/github/v/release/Dragonk/decky-optiscaler)](https://github.com/Dragonk/decky-optiscaler/releases/latest)

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin that installs and
configures [OptiScaler](https://github.com/optiscaler/OptiScaler) per game from Game Mode
(SteamOS, Bazzite, whatever you run). Frame generation, upscaler overrides and the rest of
OptiScaler's settings, with a gamepad. The ones OptiScaler can change on the fly apply to the
running game; the rest say plainly that they take effect on the next launch.

OptiScaler v10.0.0-pre1 (nightly 2026-11-04) is bundled, together with the FidelityFX SDK
4.1.2 upscalers it reads (`amd_fidelityfx_upscaler_dx12.dll` and
`amd_fidelityfx_upscaler_vk.dll`, carrying the FSR 4 and FSR 4 INT8-Lite models), so
installing works offline and every game gets the same build.

> **Unofficial.** I am an independent developer with no connection to the OptiScaler project.
> This plugin is not made, endorsed or supported by them — it bundles their release and drives
> it from the Steam Deck UI. Please report problems with the plugin
> [here](https://github.com/Dragonk/decky-optiscaler/issues), not to the OptiScaler
> maintainers.

## What it does

- **Finds your games and the folder to install into.** Steam libraries from
  `libraryfolders.vdf` including the SD card, non-Steam shortcuts, and any folder you add as a
  custom library. OptiScaler has to sit next to the executable that creates the D3D device, so
  the plugin scores the candidates (Unreal's `Binaries/Win64`, Cyberpunk's `bin/x64`) and lets
  you override its pick. Shortcuts added by
  [NonSteamLaunchers](https://github.com/moraroy/NonSteamLaunchers) resolve too: their EXE is
  the launcher, not the game, so the plugin follows the launcher's URL argument — Epic, Battle.net,
  Ubisoft Connect, EA App, Amazon Games, GOG Galaxy — to the game's own folder inside the
  launcher's Proton prefix, and merges its launch options with the shortcut's instead of
  replacing them. Xodus Nexus (renamed Nexus Launcher in 0.5) works too: it is a
  native Linux AppImage, not a Proton prefix, so its shortcuts name the game by id
  and the plugin reads the launcher's own `launcher-state.json` to find the exact
  folder. Encrypted games run differently: Xodus starts them out of a temporary
  chain view it materializes next to the game's root folder, mirroring it by
  symlinks, and tears it down when the game exits — so anything installed
  into the game folder before launch, OptiScaler included, is visible to the
  game, but nothing added while it runs is. Its backend also scrubs
  `WINEDLLOVERRIDES` inherited from Steam's launch options — only the options
  configured inside Xodus reach the game, and Xodus already forces the
  native `dxgi.dll` its runtime loads from the view. The live panel offers
  `Check Xodus launch views`: run it while the game is up and it reads the
  view the executable actually started from — found next to the game's root,
  which may sit several levels above the folder the panel manages — reporting
  which of OptiScaler's files were linked into it and where they point. Live
  control follows the game in there too: status, log and commands are read
  from and written to the view's copy of the game folder, so an encrypted
  game is steered live like any other. Install live control with the game
  closed, then start it: a view only links what existed at launch.
- **Sets the game up from the wiki, online or not.** Your game is matched against the OptiScaler
  [Compatibility List](https://github.com/optiscaler/OptiScaler/wiki/Compatibility-List), with a
  search box to pin the right entry. A copy of the list ships with the plugin and the last
  download is cached, so answers come from disk at once and the refresh runs behind them. Setup
  is then a checklist — install the DLL under the filename the entry names, write the launch
  options, apply the settings it lists — and every line says which wiki field it came from
  before anything is written. Anything the plugin couldn't place is shown to you rather than
  guessed at, including the games that need
  [REFramework](https://github.com/praydog/REFramework) installed first.
- **Basic or Advanced settings.** Basic is a handful of controls (frame generation on/off, which
  generator, 2X/3X/4X, which upscaler), each driving several INI keys at once. Advanced gives
  you all 324 settings across 37 sections, generated from the comments in `OptiScaler.ini` so
  they match the shipped build. Edits keep every comment in the file, and names are the
  overlay's own.
- **FSR 4 Lite on Steam Deck.** Every install writes the v10 switches that reach FSR 4 on
  RDNA 2 — `Fsr4GpuSupport=4` (INT8, "can enable it on unsupported GPUs") and `Fsr4Model=3`
  (INT8 Lite, the smaller model meant for APUs) — using the FidelityFX SDK upscalers shipped
  in the payload, so there is nothing to download. **FSR 4 Lite — Steam Deck** in Basic settings (re)applies
  them; **FSR 4** is the native-detection choice for RDNA 3/4. See
  [Steam Deck FSR 4](docs/steam-deck-fsr4.md) for verification, rollback, and limitations.
- **Changes settings while you play.** A small ASI plugin can apply frame generation, the
  FidelityFX FG version, the upscaler and the FSR 4 model immediately from the Quick Access
  panel — next to what the game actually ended up running and, with frame generation on, both
  frame rates. The ASI is built from `asi/` against the same OptiScaler release the plugin
  bundles (v10 here) and validates OptiScaler's in-memory layout before it writes anything, so
  a release it does not recognise reports live control as unavailable rather than guessing.
  See [Live in-game control](#live-in-game-control).
- **Doesn't lose your files, or your launch options.** Anything an install would overwrite is
  moved into `decky_optiscaler_backup_files/` and put back on uninstall. The launch options the
  game had beforehand are kept the same way, so removing OptiScaler can offer to restore them
  rather than clearing a field it never owned.
- **Odds and ends.** `OptiScaler.log` is parsed for the backend that got created, the GPU and
  the Proton version. [OptiPatcher](https://github.com/optiscaler/OptiPatcher) is bundled. An
  **OptiScaler Settings** entry is added to the game's Steam library context menu.

## Screenshots

<img src="assets/quick-access-live-tiles.jpg" alt="The Quick Access panel over a running game, showing base and frame-generated frame rates side by side, frame generation on, and FSR 4.1.1 as the upscaler" />

Over the running game: what it renders, what reaches the screen, and the exact
FSR version it ended up with — above the controls that change them.

| | |
|---|---|
| <img src="assets/library-context-menu.jpg" alt="The Steam library context menu with an OptiScaler Settings entry" /> | <img src="assets/setup-checklist.jpg" alt="The setup checklist for a game matched on the OptiScaler wiki" /> |
| **OptiScaler Settings** in the game's library context menu. | Setup is a checklist, and it says what it will write before it writes it. |
| <img src="assets/quick-access-frame-generation.jpg" alt="The Quick Access panel showing the frame generation toggle, the in-game state and the frame rate" /> | <img src="assets/quick-access-upscaler.jpg" alt="The Quick Access panel showing the upscaler override and the FG method the wiki recommends" /> |
| Frame generation, the FidelityFX FG version and the live frame rate, over the running game. | The upscaler applies live too; what doesn't is under **Needs a restart**, with the wiki's recommendation under it. |

## Installing

Grab `Decky-OptiScaler-v*.zip` from the
[latest release](https://github.com/danielcamilo1/decky-optiscaler/releases/latest), then either:

- In Game Mode, open Decky's settings, turn on **Developer mode**, and use
  **Install Plugin from URL** with the zip's download link; or
- unpack the zip into `~/homebrew/plugins/` and restart Decky Loader.

Every release bundles OptiScaler itself, so there is nothing else to download.
See the [changelog](CHANGELOG.md) for what changed.

## Live in-game control

OptiScaler reads its INI once, at startup — no file watcher, no IPC — and its overlay gets away
with live changes only because it *is* the game process. So the plugin ships a small ASI plugin
that OptiScaler loads into the game and that makes the same writes the overlay makes. It is
compiled from `asi/` against the bundled OptiScaler release — v10 — and every offset it computes
into OptiScaler's `Config` and `State` is checked against what is actually there before it writes,
so an unrecognised release leaves live control reporting itself unavailable instead of writing
into the wrong object. That is what lets the Quick Access panel change, mid-game:

- **Frame generation** — `Config::FGEnabled`, read every frame.
- **Upscaler** — the backend id into `State::newBackend`, then every entry of
  `State::changeBackend` marked. The overlay's "Change Upscaler" in full. v10's ids are `ffx`
  and `ffx_12` where 0.9.4 used `fsr31` and `fsr31_12`; both spellings are accepted.
- **FidelityFX FG version** — `Config::FfxFGIndex`, then `State::fgChanged` and
  `State::scChanged`, so the generator's context is destroyed and rebuilt on the new index. The
  versions offered are the ones the SDK reported to *that* game.
- **FSR version** — `Config::FfxUpscalerIndex` plus the same feature rebuild. One backend id
  covers every FSR from 2.3.4 to 4.1.2, so the exact version comes from the list the running
  game reported — the same one its overlay names in the title bar. v10 keeps a separate list per
  graphics API, so the plugin reads the Dx12 one and falls back to Vulkan.
- **FSR 4 model** — `Config::Fsr4GpuSupport` and `Config::Fsr4Model`, the two v10 enums behind
  the FSR 4 Lite switch.

It also reads out both frame rates: what the game renders next to what reaches the screen, and
says when the generator is switched on but not actually inserting frames.

## Steam launch options

Proton loads its own `dxgi.dll` unless you tell it not to, so the proxy needs an override:

```
WINEDLLOVERRIDES="dxgi=n,b" %command%
```

Setup shows the exact string for the filename you picked and can write it for you.
`OptiScaler.asi` installs don't need it.

Whatever Steam was passing beforehand is recorded next to the install, so removing OptiScaler
asks what to do with the field: restore exactly what was there, remove only the OptiScaler
override, or leave it alone. The answer can be remembered; **Settings** on the main page lists
remembered answers and takes them back.

## Requirements

- Decky Loader
- One of `7z`, `7zz`, `7za`, `7zr` or `bsdtar` to unpack the bundled release. SteamOS has both
  p7zip and bsdtar. It runs once, on first install.

## Building

```sh
pnpm install
python3 scripts/generate_schema.py   # option metadata, from the reference INI
python3 scripts/fetch_compat_seed.py # refresh the bundled compatibility list
./asi/build.sh                       # live-control ASI -> bin/ (needs zig)
pnpm build
python3 scripts/package.py           # -> out/Decky OptiScaler.zip
```

`asi/build.sh` cross-compiles a Windows x64 DLL with `zig cc`, so you don't need MSVC or a
Windows machine; `brew install zig` is the only prerequisite. It regenerates
`asi/generated/config_mirror.h` from the OptiScaler headers in `asi/optiscaler_ref/` first, so
that mirror is always the layout the ASI was built against. Packaging without the ASI works
fine, live control just reports itself as unavailable.

Tests:

```sh
python3 scripts/selftest.py                          # backend, against a synthetic library
HARNESS=run.tsx node testharness/build-and-run.mjs    # renders the UI headlessly
HARNESS=all-options.tsx node testharness/build-and-run.mjs
```

## Support

This plugin is free and open source, and it will stay that way. If it got a game running better
on your Deck and you feel like saying thanks, you can buy me a coffee — it is genuinely
appreciated and it keeps the updates coming ☕

[![Support me on Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/danielcamilo)

## Credits

This is an unofficial, independently developed plugin. It is not affiliated with, endorsed by or
supported by the OptiScaler project or any of the projects below; all it does is package and
drive their work.

- [OptiScaler](https://github.com/optiscaler/OptiScaler) and its wiki contributors.
- [Decky Framegen](https://github.com/xXJSONDeruloXx/Decky-Framegen) — reference for how
  OptiScaler is deployed into a game folder on Linux.
- [Decky LSFG-VK](https://github.com/xXJSONDeruloXx/decky-lsfg-vk) — reference for the
  configuration-driven plugin UI.

## AI disclosure

This plugin was built with heavy use of AI: Claude Opus 5 was the model mainly used for its development. Every design decision, review and manual testing runs were mine, and everything here has been run on an Xbox Ally X running Bazzite.
