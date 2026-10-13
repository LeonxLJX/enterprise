/**
 * Blocking modal for an ended evaluation trial.
 *
 * Choose Plan and Contact Sales stay available to everyone, matching the
 * earlier free-trial modal. Entering a license key is Super Admin only:
 * members cannot apply a key, and the install still has no license API.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  CONTACT_SALES_PATH,
  PRICING_URL,
} from "#/components/features/billing/app-status-banner";
import { BrandButton } from "#/components/features/settings/brand-button";
import { SettingsInput } from "#/components/features/settings/settings-input";
import { ModalBackdrop } from "#/components/shared/modals/modal-backdrop";
import { ModalBody } from "#/components/shared/modals/modal-body";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";

interface AppStatusExpiredModalProps {
  showLicenseKey: boolean;
}

export function AppStatusExpiredModal({
  showLicenseKey,
}: AppStatusExpiredModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [licenseKey, setLicenseKey] = useState("");

  return (
    <ModalBackdrop aria-label={t(I18nKey.STATUS_BANNER$EXPIRED_TITLE)}>
      <ModalBody
        testID="app-status-expired-modal"
        className="w-[480px] max-w-[92vw] items-start border border-tertiary"
      >
        <div className="flex w-full flex-col gap-2">
          <h3 className="text-xl font-bold text-white">
            {t(I18nKey.STATUS_BANNER$EXPIRED_TITLE)}
          </h3>
          <p className="text-sm leading-5 text-[var(--oh-muted)]">
            {t(I18nKey.STATUS_BANNER$EXPIRED_DESCRIPTION)}
          </p>
        </div>
        <div className="flex w-full flex-row gap-2">
          <BrandButton
            type="button"
            variant="primary"
            testId="app-status-expired-choose-plan"
            className="min-w-0 flex-1"
            onClick={() =>
              window.open(PRICING_URL, "_blank", "noopener,noreferrer")
            }
          >
            {t(I18nKey.STATUS_BANNER$CHOOSE_PLAN)}
          </BrandButton>
          <BrandButton
            type="button"
            variant="secondary"
            testId="app-status-expired-contact-sales"
            className="min-w-0 flex-1"
            onClick={() => navigate(CONTACT_SALES_PATH)}
          >
            {t(I18nKey.STATUS_BANNER$CONTACT_SALES)}
          </BrandButton>
        </div>
        {showLicenseKey && (
          <div className="flex w-full flex-col items-center gap-3">
            {!licenseOpen ? (
              <button
                type="button"
                data-testid="app-status-expired-enter-key"
                className={cn(
                  "text-sm font-medium text-white underline-offset-2",
                  "hover:text-white/80 hover:underline",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
                )}
                onClick={() => setLicenseOpen(true)}
              >
                {t(I18nKey.STATUS_BANNER$ENTER_LICENSE_KEY)}
              </button>
            ) : (
              <div
                className="flex w-full flex-col gap-2"
                data-testid="app-status-expired-license-form"
              >
                <SettingsInput
                  label={t(I18nKey.STATUS_BANNER$LICENSE_KEY_LABEL)}
                  type="text"
                  value={licenseKey}
                  placeholder={t(I18nKey.STATUS_BANNER$LICENSE_KEY_PLACEHOLDER)}
                  onChange={setLicenseKey}
                />
                <BrandButton
                  type="button"
                  variant="secondary"
                  testId="app-status-expired-apply-key"
                  className="w-full"
                  isDisabled={!licenseKey.trim()}
                  onClick={() => undefined}
                >
                  {t(I18nKey.STATUS_BANNER$APPLY_LICENSE_KEY)}
                </BrandButton>
              </div>
            )}
          </div>
        )}
      </ModalBody>
    </ModalBackdrop>
  );
}
