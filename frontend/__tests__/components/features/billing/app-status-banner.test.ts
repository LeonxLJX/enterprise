import { describe, expect, it } from "vitest";
import {
  createAppStatusBanner,
  installationStatusFromSearch,
  resolveVisibleStatusBanner,
} from "#/components/features/billing/app-status-banner";

describe("installation status banners", () => {
  it("defaults to Limited Demo when the query does not name a state", () => {
    expect(installationStatusFromSearch(new URLSearchParams()).id).toBe(
      "limited-demo",
    );
  });

  it("reads a review state and the evaluation day count from the query", () => {
    const status = installationStatusFromSearch(
      new URLSearchParams("statusBanner=evaluation-trial&statusDays=12"),
    );

    expect(status).toEqual({
      id: "evaluation-trial",
      audience: "everyone",
      daysLeft: 12,
    });
  });

  it("keeps registration paperwork for the Super Admin", () => {
    const pending = createAppStatusBanner("registration-pending");

    expect(resolveVisibleStatusBanner(pending, true)?.id).toBe(
      "registration-pending",
    );
    expect(resolveVisibleStatusBanner(pending, false)?.id).toBe("limited-demo");
  });

  it("hides a registered install from everyone except the Super Admin", () => {
    const registered = createAppStatusBanner("registered");

    expect(resolveVisibleStatusBanner(registered, true)?.id).toBe("registered");
    expect(resolveVisibleStatusBanner(registered, false)).toBeNull();
  });

  it("shows an ended trial to every signed-in viewer", () => {
    const expired = installationStatusFromSearch(
      new URLSearchParams("statusBanner=trial-expired"),
    );

    expect(expired.daysLeft).toBe(0);
    expect(resolveVisibleStatusBanner(expired, false)?.id).toBe(
      "trial-expired",
    );
  });
});
