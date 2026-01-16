import { join } from "path";

interface TokenConfig {
  refresh_token: string;
  client_id: string;
  access_token?: string;
  token_expiry?: string;
}

interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export type RefreshResult =
  | { success: true }
  | { success: false; reason: "invalid_grant" | "other" };

export class TokenManager {
  private configFile: string;
  private refreshToken: string | null = null;
  private clientId: string | null = null;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(configFile: string = "config.json") {
    this.configFile = configFile;
  }

  /**
   * Load configuration from config.json
   */
  async loadConfig(): Promise<boolean> {
    try {
      const file = Bun.file(this.configFile);
      
      if (!await file.exists()) {
        console.error(`Config file ${this.configFile} does not exist. Please create it from config.json.template`);
        return false;
      }

      const content = await file.text();
      const config: TokenConfig = JSON.parse(content);

      this.refreshToken = config.refresh_token || null;
      this.clientId = config.client_id || null;
      this.accessToken = config.access_token || null;
      
      if (config.token_expiry) {
        this.tokenExpiry = new Date(config.token_expiry);
      }

      console.log(`Configuration loaded from ${this.configFile}`);
      return true;
    } catch (error) {
      console.error(`Error loading config from ${this.configFile}:`, error);
      return false;
    }
  }

  /**
   * Save configuration to config.json
   */
  async saveConfig(): Promise<void> {
    try {
      let config: TokenConfig = {
        refresh_token: "",
        client_id: ""
      };

      // Try to read existing config to preserve other fields
      const file = Bun.file(this.configFile);
      if (await file.exists()) {
        const content = await file.text();
        config = JSON.parse(content);
      }

      // Update with current values
      if (this.refreshToken) config.refresh_token = this.refreshToken;
      if (this.clientId) config.client_id = this.clientId;
      if (this.accessToken) config.access_token = this.accessToken;
      if (this.tokenExpiry) {
        config.token_expiry = this.tokenExpiry.toISOString();
      }

      await Bun.write(this.configFile, JSON.stringify(config, null, 2));
      console.log(`Configuration saved to ${this.configFile}`);
    } catch (error) {
      console.error(`Error saving config to ${this.configFile}:`, error);
    }
  }

  /**
   * Check if the access token is expired
   */
  isTokenExpired(): boolean {
    if (!this.accessToken || !this.tokenExpiry) {
      return true;
    }

    // Consider expired if less than 5 minutes remaining
    const buffer = 5 * 60 * 1000; // 5 minutes in milliseconds
    const now = new Date();
    return now.getTime() >= (this.tokenExpiry.getTime() - buffer);
  }

  /**
   * Refresh the access token using the refresh token
   */
  async refreshAccessToken(): Promise<RefreshResult> {
    console.log("Obtaining new access token from refresh token...");

    if (!this.refreshToken) {
      console.error("No refresh token available in config.json");
      return { success: false, reason: "other" };
    }

    if (!this.clientId) {
      console.error("No client_id found in config.json");
      return { success: false, reason: "other" };
    }

    const url = "https://api.workos.com/user_management/authenticate";
    const data = {
      client_id: this.clientId,
      grant_type: "refresh_token",
      refresh_token: this.refreshToken
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error obtaining access token: ${response.status}`);
        console.error(`Response body: ${errorText}`);

        // Check if it's an invalid_grant error (expired/invalid refresh token)
        if (errorText.includes("invalid_grant")) {
          return { success: false, reason: "invalid_grant" };
        }
        return { success: false, reason: "other" };
      }

      const result: AuthResponse = await response.json();

      this.accessToken = result.access_token;

      // Handle refresh token rotation
      if (result.refresh_token) {
        this.refreshToken = result.refresh_token;
        console.log("Refresh token was rotated");
      }

      const expiresIn = result.expires_in || 3600;
      this.tokenExpiry = new Date(Date.now() + expiresIn * 1000);

      // Save the new tokens
      await this.saveConfig();

      console.log(`Successfully obtained access token (expires in ${expiresIn} seconds)`);
      return { success: true };
    } catch (error) {
      console.error("Error obtaining access token:", error);
      return { success: false, reason: "other" };
    }
  }

  /**
   * Get a valid access token, refreshing if necessary
   * Returns the token on success, or a RefreshResult with failure reason
   */
  async getValidToken(): Promise<string | RefreshResult> {
    if (this.isTokenExpired()) {
      const result = await this.refreshAccessToken();
      if (!result.success) {
        console.error("Failed to obtain access token");
        return result;
      }
    }

    return this.accessToken!;
  }

  /**
   * Update tokens in the configuration
   */
  async updateTokens(refreshToken: string, clientId: string): Promise<void> {
    this.refreshToken = refreshToken;
    this.clientId = clientId;
    await this.saveConfig();
  }
}
