import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitProviderConnection } from "#/components/features/settings/git-settings/git-provider-connection";
import UserService from "#/api/user-service/user-service.api";
import OptionService from "#/api/option-service/option-service.api";
import { createMockWebClientConfig } from "#/mocks/settings-handlers";
import { QUERY_KEYS } from "#/hooks/query/query-keys";
import * as ToastHandlers from "#/utils/custom-toast-handlers";
import OAuthService from "#/api/oauth-service/oauth-service.api";
import type { OAuthProviderSummary } from "#/api/oauth-service/oauth.types";

const defaultFeatureFlags = createMockWebClientConfig().feature_flags;

const oauthProvider = (
  overrides: Partial<OAuthProviderSummary>,
): OAuthProviderSummary => ({
  id: 1,
  kind: "OAuthProviderDetails",
  title: "Provider",
  is_idp: false,
  provider_type: null,
  ...overrides,
});

describe("GitProviderConnection", () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const renderComponent = (isConnected: boolean) =>
    render(
      <QueryClientProvider client={queryClient}>
        <GitProviderConnection
          provider="github"
          providerName="GitHub"
          isConnected={isConnected}
        >
          <span data-testid="connected-only-child">child</span>
        </GitProviderConnection>
      </QueryClientProvider>,
    );

  beforeEach(() => {
    queryClient.clear();
    vi.spyOn(OptionService, "getConfig").mockResolvedValue(
      createMockWebClientConfig({
        app_mode: "saas",
        auth_url: "auth.example.com",
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("should offer to connect a provider that is not connected", () => {
    // Act
    renderComponent(false);

    // Assert
    expect(screen.getByTestId("connect-github-button")).toBeInTheDocument();
    expect(
      screen.queryByTestId("disconnect-github-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("connected-only-child"),
    ).not.toBeInTheDocument();
  });

  it("should show the provider extras and a disconnect button once connected", () => {
    // Act
    renderComponent(true);

    // Assert
    expect(screen.getByTestId("connected-only-child")).toBeInTheDocument();
    expect(screen.getByTestId("disconnect-github-button")).toBeInTheDocument();
    expect(
      screen.queryByTestId("connect-github-button"),
    ).not.toBeInTheDocument();
  });

  it("should send the user to the Keycloak account-linking flow when connecting", async () => {
    // Arrange
    vi.stubGlobal("location", {
      href: "https://app.example.com/settings/integrations",
    });
    renderComponent(false);

    // Act
    await userEvent.click(screen.getByTestId("connect-github-button"));

    // Assert
    const target = new URL(window.location.href);
    expect(target.pathname).toBe(
      "/realms/allhands/protocol/openid-connect/auth",
    );
    expect(target.searchParams.get("kc_action")).toBe("idp_link:github");
  });

  it.each(["enable_integrated_idp", "enable_oauth_v2_login"] as const)(
    "should link through the OAuth v2 flow instead of Keycloak when %s is on",
    async (flag) => {
      // Arrange
      vi.spyOn(OptionService, "getConfig").mockResolvedValue(
        createMockWebClientConfig({
          app_mode: "saas",
          feature_flags: { ...defaultFeatureFlags, [flag]: true },
        }),
      );
      vi.spyOn(OAuthService, "listProviders").mockResolvedValue([
        oauthProvider({ id: 1, kind: "PasswordProviderDetails", is_idp: true }),
        oauthProvider({ id: 7, provider_type: "gitlab" }),
        oauthProvider({ id: 3, provider_type: "github" }),
      ]);
      const startLinkSpy = vi
        .spyOn(OAuthService, "startLink")
        .mockResolvedValue("https://github.com/login/oauth/authorize?state=s");
      vi.stubGlobal("location", {
        href: "https://app.example.com/settings/integrations",
      });
      renderComponent(false);
      await waitFor(() =>
        expect(
          queryClient.getQueryData(QUERY_KEYS.WEB_CLIENT_CONFIG),
        ).toBeDefined(),
      );

      // Act
      await userEvent.click(screen.getByTestId("connect-github-button"));

      // Assert
      await waitFor(() => expect(startLinkSpy).toHaveBeenCalledWith(3));
      await waitFor(() =>
        expect(window.location.href).toBe(
          "https://github.com/login/oauth/authorize?state=s",
        ),
      );
    },
  );

  it("should show an error toast when the provider has no OAuth v2 row", async () => {
    // Arrange
    vi.spyOn(OptionService, "getConfig").mockResolvedValue(
      createMockWebClientConfig({
        app_mode: "saas",
        feature_flags: { ...defaultFeatureFlags, enable_integrated_idp: true },
      }),
    );
    vi.spyOn(OAuthService, "listProviders").mockResolvedValue([
      oauthProvider({ id: 7, provider_type: "gitlab" }),
    ]);
    const startLinkSpy = vi.spyOn(OAuthService, "startLink");
    const errorToastSpy = vi.spyOn(ToastHandlers, "displayErrorToast");
    vi.stubGlobal("location", {
      href: "https://app.example.com/settings/integrations",
    });
    renderComponent(false);
    await waitFor(() =>
      expect(
        queryClient.getQueryData(QUERY_KEYS.WEB_CLIENT_CONFIG),
      ).toBeDefined(),
    );

    // Act
    await userEvent.click(screen.getByTestId("connect-github-button"));

    // Assert
    await waitFor(() => expect(errorToastSpy).toHaveBeenCalled());
    expect(startLinkSpy).not.toHaveBeenCalled();
    expect(window.location.href).toBe(
      "https://app.example.com/settings/integrations",
    );
  });

  it("should disconnect the provider after confirmation", async () => {
    // Arrange
    const disconnectSpy = vi
      .spyOn(UserService, "disconnectGitProvider")
      .mockResolvedValue(undefined);
    const successToastSpy = vi.spyOn(ToastHandlers, "displaySuccessToast");
    renderComponent(true);

    // Act
    await userEvent.click(screen.getByTestId("disconnect-github-button"));
    expect(disconnectSpy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("confirm-button"));

    // Assert
    await waitFor(() => expect(disconnectSpy).toHaveBeenCalledWith("github"));
    await waitFor(() => expect(successToastSpy).toHaveBeenCalled());
    expect(screen.queryByTestId("confirmation-modal")).not.toBeInTheDocument();
  });

  it("should show an error toast when disconnecting fails", async () => {
    // Arrange
    vi.spyOn(UserService, "disconnectGitProvider").mockRejectedValue(
      new Error("Failed to disconnect"),
    );
    const errorToastSpy = vi.spyOn(ToastHandlers, "displayErrorToast");
    renderComponent(true);

    // Act
    await userEvent.click(screen.getByTestId("disconnect-github-button"));
    await userEvent.click(screen.getByTestId("confirm-button"));

    // Assert
    await waitFor(() => expect(errorToastSpy).toHaveBeenCalled());
  });
});
