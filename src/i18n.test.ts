import { describe, expect, it } from "vitest";
import { pickLang } from "./i18n";

describe("pickLang", () => {
  it("follows the webview locale", () => {
    expect(pickLang("pl-PL", undefined)).toBe("pl");
    expect(pickLang("pl", "english")).toBe("pl");
  });

  it("trusts the Steam language when the webview stays English", () => {
    expect(pickLang("en-US", "polish")).toBe("pl");
    expect(pickLang("", "polish")).toBe("pl");
  });

  it("falls back to English", () => {
    expect(pickLang("en-US", "english")).toBe("en");
    expect(pickLang("de-DE", "german")).toBe("en");
    expect(pickLang(undefined, undefined)).toBe("en");
  });
});
