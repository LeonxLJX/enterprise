import { openHands } from "../open-hands-axios";
import type { OAuthProviderSummary } from "./oauth.types";

/** The OAuth v2 routes (``server/routes/oauth_v2.py``), used where there
 * is no Keycloak, e.g. installs on the integrated IDP. */
const OAuthService = {
  listProviders: async (): Promise<OAuthProviderSummary[]> => {
    const { data } = await openHands.get<{
      providers: OAuthProviderSummary[];
    }>("/oauth/providers");
    return data.providers;
  },

  /** Returns the URL that starts linking ``providerId`` to the signed-in
   * user; the browser is sent there and comes back to the integrations page. */
  startLink: async (providerId: number): Promise<string> => {
    const { data } = await openHands.post<{ start_url: string }>(
      `/oauth/${providerId}/link`,
    );
    return data.start_url;
  },
};

export default OAuthService;
