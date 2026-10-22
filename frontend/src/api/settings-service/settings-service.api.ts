import { openHands } from "../open-hands-axios";
import { Settings, SettingsSchema } from "#/types/settings";

export interface SettingsDocument {
  product: Record<string, unknown>;
  [section: string]: unknown;
}

export interface SettingsDocumentPatch {
  agent?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
  product?: Record<string, unknown>;
}

export type SettingsDocumentReadScope =
  | "effective"
  | "organization"
  | "personal";
export type SettingsDocumentWriteScope = "personal" | "organization";

/**
 * Settings service for managing application settings
 */
class SettingsService {
  /**
   * Get the settings from the server or use the default settings if not found
   */
  static async getSettings(): Promise<Settings> {
    const { data } = await openHands.get<Settings>("/api/v1/settings");
    return data;
  }

  /**
   * Get the AgentSettings schema used to render schema-driven settings pages.
   */
  static async getSettingsSchema(): Promise<SettingsSchema> {
    const { data } = await openHands.get<SettingsSchema>(
      "/api/v1/settings/agent-schema",
    );
    return data;
  }

  static async getConversationSettingsSchema(): Promise<SettingsSchema> {
    const { data } = await openHands.get<SettingsSchema>(
      "/api/v1/settings/conversation-schema",
    );
    return data;
  }

  static async getSettingsDocumentSchema(): Promise<SettingsSchema> {
    const { data } = await openHands.get<SettingsSchema>(
      "/api/v1/settings/document-schema",
    );
    return data;
  }

  static async getSettingsDocument(
    scope: SettingsDocumentReadScope = "effective",
  ): Promise<SettingsDocument> {
    const { data } = await openHands.get<SettingsDocument>(
      "/api/v1/settings/document",
      { params: { scope } },
    );
    return data;
  }

  static async patchSettingsDocument(
    patch: SettingsDocumentPatch,
    scope: SettingsDocumentWriteScope = "personal",
  ): Promise<SettingsDocument> {
    const { data } = await openHands.patch<SettingsDocument>(
      "/api/v1/settings/document",
      patch,
      { params: { scope } },
    );
    return data;
  }

  /**
   * Save the settings to the server. Only valid settings are saved.
   * @param settings - the settings to save
   */
  static async saveSettings(
    settings: Partial<Settings> & Record<string, unknown>,
  ): Promise<boolean> {
    const response = await openHands.post("/api/v1/settings", settings);
    return response.status === 200;
  }
}

export default SettingsService;
