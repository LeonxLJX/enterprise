/**
 * Installation status shown in the top banner.
 *
 * There is still no license endpoint (the install wizard's key box was
 * removed in OHE-3468 because nothing validated it). Until that exists,
 * signed-in sessions default to Limited Demo, and `?statusBanner=` switches
 * the other demo and registration states for review.
 *
 * Super Admin-only states describe paperwork on the install. Everyone else
 * on an unlicensed install still sees Limited Demo. A registered install
 * hides the bar from everyone except the Super Admin.
 */

export const STATUS_BANNER_QUERY_PARAM = "statusBanner";
export const STATUS_DAYS_QUERY_PARAM = "statusDays";

/** Replicated trial signup. Same URL the enterprise README points at. */
export const TRIAL_SIGNUP_URL =
  "https://install.r9.all-hands.dev/openhands/signup";

/** Existing customers sign in to the installer portal. */
export const TRIAL_LOGIN_URL =
  "https://install.r9.all-hands.dev/openhands/login";

export const PRICING_URL = "https://openhands.dev/pricing";
export const CONTACT_SALES_PATH = "/information-request";

/** Polyform evaluation length when no expiry is wired yet. */
export const DEFAULT_EVALUATION_DAYS_LEFT = 30;

export const APP_STATUS_BANNER_IDS = [
  "limited-demo",
  "registration-incomplete",
  "registration-pending",
  "evaluation-trial",
  "trial-expired",
  "registered",
] as const;

export type AppStatusBannerId = (typeof APP_STATUS_BANNER_IDS)[number];

export type AppStatusBannerAudience = "everyone" | "super-admin";

export interface AppStatusBanner {
  id: AppStatusBannerId;
  audience: AppStatusBannerAudience;
  daysLeft?: number;
}

const SUPER_ADMIN_ONLY = new Set<AppStatusBannerId>([
  "registration-incomplete",
  "registration-pending",
  "registered",
]);

function isBannerId(value: string | null): value is AppStatusBannerId {
  return (
    value != null &&
    (APP_STATUS_BANNER_IDS as readonly string[]).includes(value)
  );
}

function parseDaysLeft(raw: string | null): number {
  if (raw == null || raw.trim() === "") {
    return DEFAULT_EVALUATION_DAYS_LEFT;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_EVALUATION_DAYS_LEFT;
  }
  return Math.max(0, Math.floor(parsed));
}

/**
 * Build one banner descriptor.
 *
 * Audience is fixed by the state, not by the caller, so a preview URL cannot
 * relabel a Super Admin state as public.
 */
export function createAppStatusBanner(
  id: AppStatusBannerId,
  daysLeft = DEFAULT_EVALUATION_DAYS_LEFT,
): AppStatusBanner {
  const audience: AppStatusBannerAudience = SUPER_ADMIN_ONLY.has(id)
    ? "super-admin"
    : "everyone";

  if (id === "evaluation-trial") {
    return { id, audience, daysLeft };
  }
  if (id === "trial-expired") {
    return { id, audience, daysLeft: 0 };
  }
  return { id, audience };
}

/**
 * Read the review override from the query string.
 *
 * Unknown values fall through to Limited Demo so a bad link still shows a
 * real state. `statusDays` only affects the evaluation trial.
 */
export function installationStatusFromSearch(
  params: Pick<URLSearchParams, "get">,
): AppStatusBanner {
  const requested = params.get(STATUS_BANNER_QUERY_PARAM);
  const id = isBannerId(requested) ? requested : "limited-demo";
  return createAppStatusBanner(
    id,
    parseDaysLeft(params.get(STATUS_DAYS_QUERY_PARAM)),
  );
}

/**
 * Decide which bar this viewer actually sees.
 *
 * Super Admins see the installation state as-is. Other people on an
 * unlicensed install (incomplete or pending registration) see Limited Demo
 * instead of the paperwork. A registered install has nothing to announce
 * to them.
 */
export function resolveVisibleStatusBanner(
  status: AppStatusBanner,
  isSuperAdmin: boolean,
): AppStatusBanner | null {
  if (status.audience === "everyone" || isSuperAdmin) {
    return status;
  }
  if (status.id === "registered") {
    return null;
  }
  return createAppStatusBanner("limited-demo");
}
