import { describe, expect, it } from "vitest";
import { GENERATED_OPTIONS } from "./generatedSchema";
import {
  FG_PRESETS,
  enableFrameGenChanges,
  frameGenEnabled,
} from "./basic";

const fgInput = GENERATED_OPTIONS.find((item) => item.key === "FGInput");
const fgOutput = GENERATED_OPTIONS.find((item) => item.key === "FGOutput");

describe("frame generation presets", () => {
  it("writes only input and output values OptiScaler documents", () => {
    const validInputs = fgInput?.options ?? [];
    const validOutputs = fgOutput?.options ?? [];
    for (const preset of FG_PRESETS) {
      const input = preset.changes.find((item) => item.key === "FGInput");
      const output = preset.changes.find((item) => item.key === "FGOutput");
      expect(input?.section).toBe("FrameGen");
      expect(validInputs).toContain(input?.value);
      expect(validOutputs).toContain(output?.value);
    }
  });

  it("defaults a fresh enable to the upscaler input", () => {
    // A game with no preset held yet has nothing in the ini: the toggle must
    // arm the route that works without the game calling an FG API itself.
    const changes = enableFrameGenChanges({});
    expect(changes).toContainEqual({
      section: "FrameGen",
      key: "FGInput",
      value: "upscaler",
    });
    expect(changes).toContainEqual({
      section: "FrameGen",
      key: "FGOutput",
      value: "fsrfg",
    });
  });

  it("leaves an already-armed pair alone", () => {
    const changes = enableFrameGenChanges({
      FrameGen: { FGInput: "fsrfg", FGOutput: "xefg" },
    });
    expect(changes).toEqual([
      { section: "FrameGen", key: "Enabled", value: "true" },
    ]);
  });

  it("arms the Nukems replacement alongside the nvngx input", () => {
    const nukems = FG_PRESETS.find((preset) => preset.id === "nukems");
    expect(nukems?.changes).toContainEqual({
      section: "FrameGen",
      key: "FGNvngxReplacement",
      value: "Nukems",
    });
  });

  it("recognises frame generation as on", () => {
    expect(frameGenEnabled({ FrameGen: { Enabled: "true" } })).toBe(true);
    expect(frameGenEnabled({ FrameGen: { Enabled: "false" } })).toBe(false);
  });
});
