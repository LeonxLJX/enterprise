import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CanonicalSettingsSection } from "./canonical-settings-section";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  document: { product: { prototype_banner: "compact" } },
  schema: {
    model_name: "SettingsDocument",
    sections: [
      {
        key: "product.prototype",
        label: "Prototype settings",
        fields: [
          {
            key: "product.prototype_banner",
            label: "Prototype banner",
            section: "product.prototype",
            section_label: "Prototype settings",
            value_type: "string",
            default: "full",
            choices: [],
            depends_on: [],
            prominence: "major",
            secret: false,
          },
        ],
      },
    ],
  },
}));

vi.mock("#/hooks/query/use-settings-document", () => ({
  useSettingsDocument: () => ({ data: mocks.document }),
  useSettingsDocumentSchema: () => ({ data: mocks.schema }),
  usePatchSettingsDocument: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: false,
  }),
}));

vi.mock("#/components/features/settings/sdk-settings/schema-field", () => ({
  SchemaField: ({
    value,
    isDisabled,
    onChange,
  }: {
    value: string;
    isDisabled: boolean;
    onChange: (value: string) => void;
  }) => (
    <input
      aria-label="Prototype banner"
      value={value}
      disabled={isDisabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock("#/utils/custom-toast-handlers", () => ({
  displayErrorToast: vi.fn(),
  displaySuccessToast: vi.fn(),
}));

beforeEach(() => {
  mocks.mutateAsync.mockReset();
  mocks.mutateAsync.mockResolvedValue({ product: {} });
});

describe("CanonicalSettingsSection", () => {
  it("renders and saves a dynamic field using its full canonical path", async () => {
    render(
      <CanonicalSettingsSection
        sectionKey="product.prototype"
        isReadOnly={false}
        operation="extend"
      />,
    );

    expect(screen.getByDisplayValue("compact")).toBeInTheDocument();
    expect(screen.getByText("extend")).toBeInTheDocument();
    expect(
      screen.getByText("Effective values · personal overrides take priority"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Prototype banner"), {
      target: { value: "expanded" },
    });
    fireEvent.click(screen.getByTestId("save-canonical-settings-section"));

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        product: { prototype_banner: "expanded" },
      }),
    );

    fireEvent.click(screen.getByTestId("clear-canonical-settings-section"));

    await waitFor(() =>
      expect(mocks.mutateAsync).toHaveBeenLastCalledWith({
        product: { prototype_banner: null },
      }),
    );
  });

  it("narrows member access for locked hierarchy operations", () => {
    render(
      <CanonicalSettingsSection
        sectionKey="product.prototype"
        isReadOnly
        operation="locked"
      />,
    );

    expect(screen.getByLabelText("Prototype banner")).toBeDisabled();
    expect(
      screen.queryByTestId("save-canonical-settings-section"),
    ).not.toBeInTheDocument();
  });
});
