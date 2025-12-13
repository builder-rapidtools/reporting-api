/**
 * Authentication middleware
 * API key-based authentication for agency access
 *
 * Operating Principle: No dev-mode bypasses in production
 */

import { Env, Agency } from './types';
import { Storage } from './storage';
import { isDevMode } from './env-validator';

export interface AuthContext {
  agency: Agency;
}

/**
 * Require agency authentication via x-api-key header
 * Returns authenticated agency or throws 401 error
 */
export async function requireAgencyAuth(
  request: Request,
  env: Env
): Promise<AuthContext> {
  const storage = new Storage(env.REPORTING_KV, env.REPORTING_R2);

  // Dev mode backdoor: If REPORTING_ENV is 'dev' and no API key provided,
  // use a special dev agency
  const apiKey = request.headers.get('x-api-key');

  if (!apiKey) {
    // Check if dev mode backdoor is enabled
    // Operating Principle: No dev-mode bypasses in production
    if (isDevMode(env)) {
      // Return or create dev agency
      const devAgency = await getOrCreateDevAgency(storage);
      return { agency: devAgency };
    }

    throw new AuthError('Missing x-api-key header', 401);
  }

  // Lookup agency by API key
  const agency = await storage.getAgencyByApiKey(apiKey);

  if (!agency) {
    throw new AuthError('Invalid API key', 401);
  }

  return { agency };
}

/**
 * Get or create the special dev-mode agency
 * This should NEVER be used in production
 */
async function getOrCreateDevAgency(storage: Storage): Promise<Agency> {
  const devAgencyId = 'dev-agency';

  let devAgency = await storage.getAgency(devAgencyId);

  if (!devAgency) {
    // Create dev agency with known ID
    devAgency = {
      id: devAgencyId,
      name: 'Dev Agency',
      billingEmail: 'dev@localhost',
      apiKey: 'dev-api-key',
      subscriptionStatus: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await storage.saveAgency(devAgency);
  }

  return devAgency;
}

/**
 * Check if agency subscription is active
 * Throws 402 Payment Required if subscription is inactive
 */
export function requireActiveSubscription(agency: Agency): void {
  const activeStatuses: Agency['subscriptionStatus'][] = ['trial', 'active'];

  if (!activeStatuses.includes(agency.subscriptionStatus)) {
    throw new AuthError(
      `Subscription inactive. Status: ${agency.subscriptionStatus}`,
      402,
      {
        subscriptionStatus: agency.subscriptionStatus,
      }
    );
  }
}

/**
 * Custom authentication error
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 401,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'AuthError';
  }

  toJSON() {
    return {
      success: false,
      error: this.message,
      ...this.metadata,
    };
  }
}
