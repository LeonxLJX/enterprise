import { useMutation } from "@tanstack/react-query";
import OAuthService from "#/api/oauth-service/oauth-service.api";
import { Provider } from "#/types/settings";

/** Starts linking a git provider through the OAuth v2 routes and sends the
 * browser to the provider. */
export const useStartGitProviderLink = () =>
  useMutation({
    mutationFn: async (provider: Provider) => {
      const providers = await OAuthService.listProviders();
      const gitProvider = providers.find(
        (p) => !p.is_idp && p.provider_type === provider,
      );
      if (!gitProvider) {
        throw new Error(`${provider} is not configured on this install`);
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
