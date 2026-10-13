/**
 * Slim status strip for the current demo or registration state.
 *
 * Same chrome as the earlier Enterprise Free Trial bar: one line, a label,
 * and the actions that belong to that state. Copy and buttons change with
 * the state; the strip itself does not.
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  CONTACT_SALES_PATH,
  PRICING_URL,
  TRIAL_LOGIN_URL,
  TRIAL_SIGNUP_URL,
  type AppStatusBanner,
} from "#/components/features/billing/app-status-banner";
import { I18nKey } from "#/i18n/declaration";
import { Typography } from "#/ui/typography";
import { cn } from "#/utils/utils";

const barButtonClassName = cn(
  "inline-flex h-6 items-center justify-center rounded-md px-2.5",
  "text-xs font-semibold transition-opacity hover:opacity-80",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
);

interface BannerAction {
  testId: string;
  label: string;
  href: string;
  external: boolean;
  variant: "primary" | "secondary";
}

interface AppStatusTopBarProps {
  status: AppStatusBanner;
}

function StatusAction({ action }: { action: BannerAction }) {
  const className = cn(
    barButtonClassName,
    action.variant === "primary"
      ? "bg-white text-blue-700 focus-visible:outline-white"
      : "border border-white/50 bg-transparent text-white focus-visible:outline-white",
  );

  if (action.external) {
    return (
      <a
        href={action.href}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={action.testId}
        className={className}
      >
        {action.label}
      </a>
    );
  }

  return (
    <Link to={action.href} data-testid={action.testId} className={className}>
      {action.label}
    </Link>
  );
}

function describeStatus(
  status: AppStatusBanner,
  t: ReturnType<typeof useTranslation>["t"],
): { label: string; detail: string | null; actions: BannerAction[] } {
  switch (status.id) {
    case "limited-demo":
      return {
        label: t(I18nKey.STATUS_BANNER$LIMITED_DEMO),
        detail: null,
        actions: [
          {
            testId: "app-status-register-now",
            label: t(I18nKey.STATUS_BANNER$REGISTER_NOW),
            href: TRIAL_SIGNUP_URL,
            external: true,
            variant: "primary",
          },
          {
            testId: "app-status-login",
            label: t(I18nKey.STATUS_BANNER$LOGIN),
            href: TRIAL_LOGIN_URL,
            external: true,
            variant: "secondary",
          },
        ],
      };
    case "registration-incomplete":
      return {
        label: t(I18nKey.STATUS_BANNER$REGISTRATION_INCOMPLETE),
        detail: null,
        actions: [
          {
            testId: "app-status-finish-registration",
            label: t(I18nKey.STATUS_BANNER$FINISH_REGISTRATION),
            href: TRIAL_SIGNUP_URL,
            external: true,
            variant: "primary",
          },
        ],
      };
    case "registration-pending":
      return {
        label: t(I18nKey.STATUS_BANNER$REGISTRATION_PENDING),
        detail: t(I18nKey.STATUS_BANNER$REGISTRATION_PENDING_DETAIL),
        actions: [],
      };
    case "evaluation-trial":
      return {
        label: t(I18nKey.STATUS_BANNER$EVALUATION_TRIAL),
        detail: t(I18nKey.STATUS_BANNER$DAYS_LEFT, {
          count: status.daysLeft ?? 0,
        }),
        actions: [
          {
            testId: "app-status-choose-plan",
            label: t(I18nKey.STATUS_BANNER$CHOOSE_PLAN),
            href: PRICING_URL,
            external: true,
            variant: "primary",
          },
          {
            testId: "app-status-contact-sales",
            label: t(I18nKey.STATUS_BANNER$CONTACT_SALES),
            href: CONTACT_SALES_PATH,
            external: false,
            variant: "secondary",
          },
        ],
      };
    case "trial-expired":
      return {
        label: t(I18nKey.STATUS_BANNER$TRIAL_ENDED),
        detail: null,
        actions: [
          {
            testId: "app-status-register-now",
            label: t(I18nKey.STATUS_BANNER$REGISTER_NOW),
            href: TRIAL_SIGNUP_URL,
            external: true,
            variant: "primary",
          },
        ],
      };
    case "registered":
      return {
        label: t(I18nKey.STATUS_BANNER$REGISTERED),
        detail: t(I18nKey.STATUS_BANNER$REGISTERED_DETAIL),
        actions: [],
      };
    default: {
      const unreachable: never = status.id;
      return unreachable;
    }
  }
}

export function AppStatusTopBar({ status }: AppStatusTopBarProps) {
  const { t } = useTranslation();
  const { label, detail, actions } = describeStatus(status, t);

  return (
    <div
      data-testid="app-status-top-bar"
      data-status={status.id}
      role="region"
      aria-label={t(I18nKey.STATUS_BANNER$REGION_LABEL)}
      className={cn(
        "flex w-full shrink-0 flex-wrap items-center justify-between gap-2",
        "bg-blue-600 px-3 py-1 text-white",
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Typography.Text className="text-xs font-semibold text-white">
          {label}
        </Typography.Text>
        {detail != null && (
          <Typography.Text
            testId="app-status-detail"
            className="text-xs font-medium text-white/90"
          >
            {detail}
          </Typography.Text>
        )}
      </div>
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {actions.map((action) => (
            <StatusAction key={action.testId} action={action} />
          ))}
        </div>
      )}
    </div>
  );
}
