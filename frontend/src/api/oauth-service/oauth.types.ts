export interface OAuthProviderSummary {
  id: number;
  kind: string;
  title: string;
  is_idp: boolean;
  /** The git provider (e.g. "gitlab") for OAuth providers, else null. */
  provider_type: string | null;
}
