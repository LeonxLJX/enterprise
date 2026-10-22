import { describe, expect, it } from "vitest";
import {
  getDynamicSettingsSections,
  getSettingsDocumentSectionPath,
} from "./settings-document-pages";
import { SettingsSchema } from "#/types/settings";

describe("settings document pages", () => {
  it("returns only SDK extension sections after resources", () => {
    const schema = {
      model_name: "SettingsDocument",
      sections: [
        { key: "product.general", label: "Product", fields: [] },
        { key: "resources", label: "Resources", fields: [] },
        {
          key: "product.prototype",
          label: "Prototype settings",
          fields: [],
        },
      ],
    } as SettingsSchema;

    expect(
      getDynamicSettingsSections(schema).map((section) => section.key),
    ).toEqual(["product.prototype"]);
  });

  it("encodes section keys in route paths", () => {
    expect(getSettingsDocumentSectionPath("product.prototype")).toBe(
      "/settings/document/product.prototype",
    );
  });
});
