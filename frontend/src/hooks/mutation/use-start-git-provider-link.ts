import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import OAuthService from "#/api/oauth-service/oauth-service.api";
import { I18nKey } from "#/i18n/declaration";
import { Provider } from "#/types/settings";
import { getProviderName } from "#/utils/utils";

/** Starts linking a git provider through the OAuth v2 routes and sends the
 * browser to the provider. */
export const useStartGitProviderLink = () => {
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (provider: Provider) => {
      const providers = await OAuthService.listProviders();
      const gitProvider = providers.find(
        (p) => !p.is_idp && p.provider_type === provider,
      );
      if (!gitProvider) {
        throw new Error(
          t(I18nKey.SETTINGS$GIT_PROVIDER_NOT_CONFIGURED, {
            provider: getProviderName(provider),
          }),
        );
      }
      return OAuthService.startLink(gitProvider.id);
    },
    onSuccess: (startUrl) => {
      window.location.href = startUrl;
    },
    meta: {
      disableToast: true,
    },
  });
};
