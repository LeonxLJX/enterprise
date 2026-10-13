/**
 * Top-of-app status chrome: the banner, and the blocking trial-ended modal
 * when that is the visible state.
 *
 * The query string selects the installation state (`?statusBanner=`).
 * Whether this viewer sees it depends on Super Admin access.
 */
import { useSearchParams } from "react-router";
import {
  installationStatusFromSearch,
  resolveVisibleStatusBanner,
} from "#/components/features/billing/app-status-banner";
import { AppStatusExpiredModal } from "#/components/features/billing/app-status-expired-modal";
import { AppStatusTopBar } from "#/components/features/billing/app-status-top-bar";

interface AppStatusChromeProps {
  isSuperAdmin: boolean;
}

export function AppStatusChrome({ isSuperAdmin }: AppStatusChromeProps) {
  const [searchParams] = useSearchParams();
  const installation = installationStatusFromSearch(searchParams);
  const visible = resolveVisibleStatusBanner(installation, isSuperAdmin);

  if (visible == null) {
    return null;
  }

  return (
    <>
      <AppStatusTopBar status={visible} />
      {visible.id === "trial-expired" && (
        <AppStatusExpiredModal showLicenseKey={isSuperAdmin} />
      )}
    </>
  );
}
