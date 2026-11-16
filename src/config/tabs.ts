import { GENERATED_OPTIONS } from "./generatedSchema";
import type { OptionMeta } from "../types";
import { t } from "../i18n";

export interface TabDefinition {
  id: string;
  title: string;
  /** INI sections shown on this tab, in display order. */
  sections: string[];
  blurb?: string;
}

/** Friendlier headings than the raw INI section names. */
export const SECTION_TITLES: Record<string, string> = {
  Upscalers: t("Upscaler Selection"),
  FrameGen: t("Frame Generation"),
  FSRFG: t("FSR Frame Generation"),
  XeFG: t("XeSS Frame Generation"),
  OptiFG: t("OptiFG & HUD Fix"),
  Nukems: "Nukem's dlssg-to-fsr3",
  FSRFGInputs: t("FSR FG Inputs"),
  Inputs: t("Upscaler Inputs"),
  Framerate: t("Framerate Limit"),
  XeSS: "XeSS",
  FSR: "FSR / FidelityFX",
  DLSS: "DLSS",
  DLSSD: "DLSS Ray Reconstruction",
  Libraries: t("Library Paths"),
  Menu: t("In-Game Overlay"),
  Spoofing: t("GPU Spoofing"),
  Plugins: t("ASI Plugins"),
  NvApi: "NvAPI",
  Dx11withDx12: "DX11 on DX12",
  Hooks: t("Hooking"),
  Sharpness: t("Sharpness"),
  OutputScaling: t("Output Scaling"),
  CAS: "Contrast Adaptive Sharpening",
  Log: t("Logging"),
  InitFlags: t("Init Flags"),
  UpscaleRatio: t("Upscale Ratio Override"),
  QualityOverrides: t("Quality Ratio Overrides"),
  DRS: t("Dynamic Resolution"),
  HDR: "HDR",
  "V-Sync": "V-Sync",
  Anisotropy: t("Anisotropic Filtering"),
  Mipmap: t("Mipmap Bias"),
  ProcessFilter: t("Process Filter"),
  Hotfix: t("Hotfixes & Workarounds"),
};

export const TABS: TabDefinition[] = [
  {
    id: "framegen",
    title: t("Frame Gen"),
    sections: ["FrameGen", "FSRFG", "XeFG", "Nukems", "FSRFGInputs"],
    blurb:
      t("Pick an FG input (where frames come from) and an FG output (which generator draws them)."),
  },
  {
    id: "upscaling",
    title: t("Upscaling"),
    sections: [
      "Upscalers",
      "Inputs",
      "FSR",
      "XeSS",
      "DLSS",
      "DLSSD",
      "OutputScaling",
      "UpscaleRatio",
      "QualityOverrides",
      "DRS",
    ],
    blurb: t("Which upscaler backend replaces the one the game asks for."),
  },
  {
    id: "hudfix",
    title: t("HUD Fix"),
    sections: ["OptiFG"],
    blurb: t("Fixes UI ghosting and flicker when frame generation is active."),
  },
  {
    id: "image",
    title: t("Image"),
    sections: ["Sharpness", "CAS", "HDR", "InitFlags", "Anisotropy", "Mipmap", "V-Sync", "Framerate"],
  },
  {
    id: "compat",
    title: t("Compatibility"),
    sections: [
      "Spoofing",
      "Hotfix",
      "Hooks",
      "NvApi",
      "Dx11withDx12",
      "Plugins",
      "ProcessFilter",
      "Libraries",
    ],
    blurb: t("Per-game workarounds. Only touch these if the wiki entry tells you to."),
  },
  { id: "overlay", title: t("Overlay"), sections: ["Menu", "Log"] },
];

/** Options surfaced at the top of a tab and in the quick panel. */
export const FEATURED: Record<string, string[]> = {
  framegen: ["FrameGen.Enabled", "FrameGen.FGInput", "FrameGen.FGOutput", "FrameGen.FTInput"],
  upscaling: ["Upscalers.Dx12Upscaler", "Upscalers.Dx11Upscaler", "Upscalers.VulkanUpscaler"],
  hudfix: ["OptiFG.HUDFix", "OptiFG.HUDFixExtended", "OptiFG.HUDLimit"],
  image: ["Sharpness.OverrideSharpness", "Sharpness.Sharpness", "Framerate.FramerateLimit"],
  compat: ["Spoofing.Dxgi", "Spoofing.StreamlineSpoofing"],
  overlay: ["Menu.OverlayMenu", "Menu.ShowFps", "Log.LogToFile"],
};

/** Quick controls shown in the Quick Access panel while a game is running. */
export const QUICK_KEYS = [
  "FrameGen.Enabled",
  "FrameGen.FGInput",
  "FrameGen.FGOutput",
  "Upscalers.Dx12Upscaler",
  "Framerate.FramerateLimit",
];

const BY_ID = new Map<string, OptionMeta>();
const BY_SECTION = new Map<string, OptionMeta[]>();

for (const option of GENERATED_OPTIONS) {
  BY_ID.set(`${option.section}.${option.key}`, option);
  const list = BY_SECTION.get(option.section) ?? [];
  list.push(option);
  BY_SECTION.set(option.section, list);
}

export const optionById = (id: string): OptionMeta | undefined => BY_ID.get(id);
export const optionsInSection = (section: string): OptionMeta[] => BY_SECTION.get(section) ?? [];
export const sectionTitle = (section: string): string => SECTION_TITLES[section] ?? section;

/** Sections that exist in the INI but are not on any tab. */
export const UNGROUPED_SECTIONS = Array.from(BY_SECTION.keys()).filter(
  (section) => !TABS.some((tab) => tab.sections.includes(section))
);
