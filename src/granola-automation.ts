import { $ } from "bun";
import { join } from "path";
import { homedir } from "os";

const GRANOLA_APP_PATH = "/Applications/Granola.app";
const GRANOLA_SUPPORT_DIR = join(homedir(), "Library/Application Support/Granola");
const SUPABASE_JSON_PATH = join(GRANOLA_SUPPORT_DIR, "supabase.json");

interface WorkOSTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  obtained_at: number;
  session_id: string;
  external_id: string;
}

interface SupabaseData {
  workos_tokens: string; // JSON string
  session_id: string;
  user_info: string;
}

export interface GranolaTokens {
  refreshToken: string;
  clientId: string;
}

/**
 * Check if Granola is currently running
 */
export async function isGranolaRunning(): Promise<boolean> {
  try {
    const result = await $`pgrep -f "Granola.app"`.quiet();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Launch Granola application
 */
export async function launchGranola(): Promise<void> {
  console.log("Launching Granola...");
  await $`open -a ${GRANOLA_APP_PATH}`;
  
  // Wait for Granola to fully start and create the supabase.json file
  // We'll check periodically for the file
  let attempts = 0;
  const maxAttempts = 30; // 30 seconds max
  
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const file = Bun.file(SUPABASE_JSON_PATH);
    if (await file.exists()) {
      // Wait an additional 2 seconds to ensure file is fully written
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log("Granola started successfully");
      return;
    }
    
    attempts++;
  }
  
  throw new Error("Granola did not start within expected time");
}

/**
 * Close Granola application
 */
export async function closeGranola(): Promise<void> {
  console.log("Closing Granola...");
  try {
    await $`osascript -e 'quit app "Granola"'`.quiet();
    // Wait a bit for the app to fully close
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log("Granola closed successfully");
  } catch (error) {
    console.warn("Warning: Could not close Granola gracefully");
  }
}

/**
 * Extract client ID from JWT access token
 */
function extractClientIdFromJWT(accessToken: string): string | null {
  try {
    // JWT has 3 parts separated by dots: header.payload.signature
    const parts = accessToken.split('.');
    if (parts.length !== 3) {
      return null;
    }
    
    // Validate and decode the payload (middle part)
    const payloadBase64 = parts[1];
    if (!payloadBase64 || !/^[A-Za-z0-9_-]+$/.test(payloadBase64)) {
      return null;
    }
    
    const payload = Buffer.from(payloadBase64, 'base64').toString('utf-8');
    const decoded = JSON.parse(payload);
    
    // Extract client_id from the 'iss' field
    // Format: https://auth.granola.ai/user_management/client_{ID}
    const iss = decoded.iss;
    if (!iss) {
      return null;
    }
    
    const CLIENT_ID_PATTERN = /client_[a-zA-Z0-9_-]+$/;
    const match = iss.match(CLIENT_ID_PATTERN);
    return match ? match[0] : null;
  } catch (error) {
    console.error("Error extracting client ID from JWT:", error);
    return null;
  }
}

/**
 * Extract tokens from Granola's supabase.json file
 */
export async function extractTokensFromGranola(): Promise<GranolaTokens> {
  console.log("Extracting tokens from Granola...");
  
  const file = Bun.file(SUPABASE_JSON_PATH);
  
  if (!await file.exists()) {
    throw new Error(`Supabase JSON file not found at ${SUPABASE_JSON_PATH}`);
  }
  
  const content = await file.text();
  const data: SupabaseData = JSON.parse(content);
  
  // Parse the workos_tokens JSON string
  const workosTokens: WorkOSTokens = JSON.parse(data.workos_tokens);
  
  const refreshToken = workosTokens.refresh_token;
  if (!refreshToken) {
    throw new Error("Refresh token not found in supabase.json");
  }
  
  // Extract client ID from access token
  const clientId = extractClientIdFromJWT(workosTokens.access_token);
  if (!clientId) {
    throw new Error("Could not extract client ID from access token");
  }
  
  console.log("Tokens extracted successfully");
  return {
    refreshToken,
    clientId
  };
}

/**
 * Automatically get tokens by managing Granola app lifecycle
 * This function will:
 * 1. Check if Granola is running, launch if not
 * 2. Extract tokens from supabase.json
 * 3. Close Granola
 * 4. Return the tokens
 */
export async function getTokensAutomatically(): Promise<GranolaTokens> {
  let wasRunning = await isGranolaRunning();
  
  if (!wasRunning) {
    await launchGranola();
  } else {
    console.log("Granola is already running");
    // Wait a bit to ensure supabase.json is up to date
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  const tokens = await extractTokensFromGranola();
  
  if (!wasRunning) {
    await closeGranola();
  } else {
    console.log("Leaving Granola running (it was already running)");
  }
  
  return tokens;
}
