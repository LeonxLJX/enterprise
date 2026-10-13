import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AppStatusChrome } from "#/components/features/billing/app-status-chrome";
import { TRIAL_SIGNUP_URL } from "#/components/features/billing/app-status-banner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count !== undefined ? `${key}:${options.count}` : key,
  }),
}));

function renderChrome(search: string, isSuperAdmin: boolean) {
  return render(
    <MemoryRouter initialEntries={[`/${search}`]}>
      <AppStatusChrome isSuperAdmin={isSuperAdmin} />
    </MemoryRouter>,
  );
}

describe("AppStatusChrome", () => {
  it("shows Limited Demo with Register Now by default", () => {
    renderChrome("", false);

    expect(screen.getByTestId("app-status-top-bar")).toHaveAttribute(
      "data-status",
      "limited-demo",
    );
    expect(screen.getByTestId("app-status-register-now")).toHaveAttribute(
      "href",
      TRIAL_SIGNUP_URL,
    );
    expect(screen.getByTestId("app-status-login")).toBeInTheDocument();
  });

  it("shows the evaluation trial countdown and plan actions", () => {
    renderChrome("?statusBanner=evaluation-trial&statusDays=12", false);

    expect(screen.getByTestId("app-status-top-bar")).toHaveAttribute(
      "data-status",
      "evaluation-trial",
    );
    expect(screen.getByTestId("app-status-detail")).toHaveTextContent(
      "STATUS_BANNER$DAYS_LEFT:12",
    );
    expect(screen.getByTestId("app-status-choose-plan")).toHaveAttribute(
      "href",
      "https://openhands.dev/pricing",
    );
    expect(screen.getByTestId("app-status-contact-sales")).toHaveAttribute(
      "href",
      "/information-request",
    );
    expect(
      screen.queryByTestId("app-status-expired-modal"),
    ).not.toBeInTheDocument();
  });

  it("keeps registration pending on the Super Admin bar only", () => {
    const { unmount } = renderChrome(
      "?statusBanner=registration-pending",
      true,
    );

    expect(screen.getByTestId("app-status-top-bar")).toHaveAttribute(
      "data-status",
      "registration-pending",
    );
    expect(screen.getByTestId("app-status-detail")).toHaveTextContent(
      "STATUS_BANNER$REGISTRATION_PENDING_DETAIL",
    );

    unmount();
    renderChrome("?statusBanner=registration-pending", false);

    expect(screen.getByTestId("app-status-top-bar")).toHaveAttribute(
      "data-status",
      "limited-demo",
    );
  });

  it("hides the registered bar from members", () => {
    renderChrome("?statusBanner=registered", false);

    expect(screen.queryByTestId("app-status-top-bar")).not.toBeInTheDocument();
  });

  it("opens the ended-trial modal and offers a license key to the Super Admin", async () => {
    const user = userEvent.setup();
    renderChrome("?statusBanner=trial-expired", true);

    expect(screen.getByTestId("app-status-top-bar")).toHaveAttribute(
      "data-status",
      "trial-expired",
    );
    expect(screen.getByTestId("app-status-expired-modal")).toBeInTheDocument();

    await user.click(screen.getByTestId("app-status-expired-enter-key"));
    expect(
      screen.getByTestId("app-status-expired-license-form"),
    ).toBeInTheDocument();
  });

  it("omits the license key from the ended-trial modal for members", () => {
    renderChrome("?statusBanner=trial-expired", false);

    expect(screen.getByTestId("app-status-expired-modal")).toBeInTheDocument();
    expect(
      screen.queryByTestId("app-status-expired-enter-key"),
    ).not.toBeInTheDocument();
  });
});
