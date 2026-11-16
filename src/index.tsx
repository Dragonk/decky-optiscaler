import { definePlugin, routerHook } from "@decky/api";
import { staticClasses } from "@decky/ui";
import { FaLayerGroup } from "react-icons/fa";
import { patchLibraryContextMenu } from "./libraryContextMenu";
import { ManagerPage } from "./components/ManagerPage";
import { QuickPanel } from "./components/QuickPanel";
import { ROUTE, openManager } from "./navigation";
import { useRunningGame } from "./hooks/useRunningGame";
import { pickLang, setLang, useLang } from "./i18n";
import { getSteamLanguage } from "./api";

function Content() {
  // Re-renders the panel when the language resolved from Steam lands.
  useLang();
  const runningGame = useRunningGame();

  // Deep-link straight to a game when the panel already knows which one, so
  // picking one does not dump the user back at the library list.
  const open = (gamePath?: string, gameName?: string, appid?: string) =>
    openManager({ path: gamePath, name: gameName, appid });

  return <QuickPanel runningGame={runningGame} onOpenManager={open} />;
}

export default definePlugin(() => {
  routerHook.addRoute(ROUTE, ManagerPage, { exact: true });
  const unpatchContextMenu = patchLibraryContextMenu();

  // The UI language follows the Steam client. The webview locale is the
  // live signal on SteamOS (it tracks the client language); the backend's
  // registry.vdf/localconfig.vdf lookup backs it up where it stays English.
  setLang(pickLang(navigator.language, undefined));
  getSteamLanguage()
    .then((result) => setLang(pickLang(navigator.language, result.language)))
    .catch(() => undefined);

  return {
    name: "Decky OptiScaler",
    titleView: <div className={staticClasses.Title}>Decky OptiScaler</div>,
    content: <Content />,
    icon: <FaLayerGroup />,
    onDismount() {
      routerHook.removeRoute(ROUTE);
      unpatchContextMenu();
    },
  };
});
