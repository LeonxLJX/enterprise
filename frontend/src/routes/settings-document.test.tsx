import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsDocumentScreen from "./settings-document";
import { ConfigurationOperation } from "#/types/settings";

const mocks = vi.hoisted(() => ({
  role: "member",
  operation: "extend" as ConfigurationOperation,
  save: vi.fn(),
}));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useParams: () => ({ sectionKey: "product.prototype" }),
}));

vi.mock("#/hooks/query/use-me", () => ({
  useMe: () => ({ data: { role: mocks.role } }),
}));

vi.mock("#/hooks/query/use-settings", () => ({
  useSettings: () => ({
    data: {
      configuration_policy: {
        llm: { operation: "subset" },
        settings: {
          "agent.condenser": { operation: "locked" },
          "product.prototype": { operation: mocks.operation },
        },
      },
    },
  }),
}));

vi.mock("#/hooks/mutation/use-save-settings", () => ({
  useSaveSettings: () => ({
    mutateAsync: mocks.save,
    isPending: false,
  }),
}));

vi.mock("#/components/features/settings/canonical-settings-section", () => ({
  CanonicalSettingsSection: ({
    sectionKey,
    isReadOnly,
    scope = "personal",
  }: {
    sectionKey: string;
    isReadOnly: boolean;
    scope?: string;
  }) => (
    <div
      data-testid="canonical-section"
      data-section={sectionKey}
      data-read-only={String(isReadOnly)}
      data-scope={scope}
    />
  ),
}));

vi.mock("#/utils/custom-toast-handlers", () => ({
  displayErrorToast: vi.fn(),
  displaySuccessToast: vi.fn(),
}));

beforeEach(() => {
  mocks.role = "member";
  mocks.operation = "extend";
  mocks.save.mockReset();
  mocks.save.mockResolvedValue(undefined);
});

describe("SettingsDocumentScreen", () => {
  it("explains effective and personal settings to regular members", () => {
    mocks.operation = "locked";
    render(<SettingsDocumentScreen />);

    expect(
      screen.getByText(/These are your effective settings/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("canonical-section")).toHaveAttribute(
      "data-section",
      "product.prototype",
    );
    expect(screen.getByTestId("canonical-section")).toHaveAttribute(
      "data-read-only",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "Locked" }),
    ).not.toBeInTheDocument();
  });

  it("lets admins configure section policy without replacing sibling rules", async () => {
    mocks.role = "admin";
    render(<SettingsDocumentScreen />);

    fireEvent.click(screen.getByRole("button", { name: /^Replace/ }));

    expect(screen.getByRole("button", { name: /^Replace/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        configuration_policy: {
          llm: { operation: "subset" },
          settings: {
            "agent.condenser": { operation: "locked" },
            "product.prototype": { operation: "replace" },
          },
        },
      }),
    );

    fireEvent.click(screen.getByRole("tab", { name: "My personal values" }));
    expect(screen.getByTestId("canonical-section")).toHaveAttribute(
      "data-scope",
      "personal",
    );
  });

  it("rolls the selected operation back when persistence fails", async () => {
    mocks.role = "admin";
    mocks.save.mockRejectedValueOnce(new Error("save failed"));
    render(<SettingsDocumentScreen />);

    fireEvent.click(screen.getByRole("button", { name: /^Locked/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Extend/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });
});
