/**
 * Environment Validation
 * Ensures production deployments fail fast if required secrets are missing
 *
 * Operating Principle: Safety over growth
 * Production must fail fast if it cannot run safely.
 */

import { Env } from './types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Required secrets for production deployment
 * If any of these are missing in production, the worker must not start
 */
const REQUIRED_PRODUCTION_SECRETS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_ID_STARTER',
  'EMAIL_PROVIDER_API_KEY',
] as const;

/**
 * Optional configuration with defaults
 */
const OPTIONAL_WITH_DEFAULTS = {
  EMAIL_FROM_ADDRESS: 'reports@rapidtools.io',
  BASE_URL: 'https://app.rapidtools.io',
} as const;

/**
 * Validate environment configuration on worker startup
 * Called from index.ts fetch handler on first request
 */
export async function validateEnvironment(env: Env): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const isProduction = env.REPORTING_ENV === 'prod';
  const isDevelopment = env.REPORTING_ENV === 'dev';

  // Validate REPORTING_ENV is set to a known value
  if (!env.REPORTING_ENV) {
    errors.push('REPORTING_ENV must be set (valid values: "dev", "prod")');
  } else if (!isDevelopment && !isProduction) {
    errors.push(`REPORTING_ENV="${env.REPORTING_ENV}" is invalid (valid values: "dev", "prod")`);
  }

  // In production, all required secrets must be present
  if (isProduction) {
    for (const secret of REQUIRED_PRODUCTION_SECRETS) {
      if (!env[secret]) {
        errors.push(`Production requires ${secret} but it is not set`);
      }
    }

    // Validate email from address format if provided
    if (env.EMAIL_FROM_ADDRESS) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(env.EMAIL_FROM_ADDRESS)) {
        errors.push(`EMAIL_FROM_ADDRESS="${env.EMAIL_FROM_ADDRESS}" is not a valid email address`);
      }
    }

    // Validate BASE_URL format if provided
    if (env.BASE_URL) {
      try {
        const url = new URL(env.BASE_URL);
        if (url.protocol !== 'https:') {
          warnings.push(`BASE_URL should use https:// in production (got ${url.protocol})`);
        }
      } catch (e) {
        errors.push(`BASE_URL="${env.BASE_URL}" is not a valid URL`);
      }
    }
  }

  // In development, warn if production secrets are set (potential misconfiguration)
  if (isDevelopment) {
    for (const secret of REQUIRED_PRODUCTION_SECRETS) {
      if (env[secret]) {
        warnings.push(`Development environment has ${secret} set - ensure this is intentional`);
      }
    }
  }

  // Validate Stripe key format
  if (env.STRIPE_SECRET_KEY) {
    const stripeKeyMode = getStripeKeyMode(env.STRIPE_SECRET_KEY);

    if (!stripeKeyMode) {
      errors.push(
        `STRIPE_SECRET_KEY has invalid format. Expected "sk_test_..." or "sk_live_..." but got "${env.STRIPE_SECRET_KEY.substring(0, 10)}..."`
      );
    } else {
      // Warn if production is using test mode (allowed for hardening)
      if (isProduction && stripeKeyMode === 'test') {
        const requireLiveStripe = env.REQUIRE_LIVE_STRIPE_IN_PROD === 'true';

        if (requireLiveStripe) {
          errors.push(
            'Production environment is using STRIPE_SECRET_KEY in TEST mode (sk_test_...). ' +
            'This must be a LIVE mode key (sk_live_...) for production. ' +
            'To allow test mode, unset REQUIRE_LIVE_STRIPE_IN_PROD.'
          );
        } else {
          warnings.push(
            'Production environment is using STRIPE_SECRET_KEY in TEST mode (sk_test_...). ' +
            'This is allowed for hardening but should be changed to LIVE mode (sk_live_...) before launch.'
          );
        }
      }

      // Validate Stripe key and price mode match by checking price existence
      if (env.STRIPE_PRICE_ID_STARTER) {
        const priceValidation = await validateStripePriceExists(
          env.STRIPE_SECRET_KEY,
          env.STRIPE_PRICE_ID_STARTER
        );

        if (!priceValidation.valid) {
          if (priceValidation.isModeMismatch) {
            errors.push(
              `Stripe key mode and price mode mismatch: ` +
              `STRIPE_SECRET_KEY is in ${stripeKeyMode} mode but STRIPE_PRICE_ID_STARTER ` +
              `("${env.STRIPE_PRICE_ID_STARTER}") does not exist in ${stripeKeyMode} mode. ` +
              `Ensure the price ID was created in the Stripe ${stripeKeyMode} mode dashboard.`
            );
          } else {
            errors.push(
              `Failed to validate STRIPE_PRICE_ID_STARTER: ${priceValidation.error || 'Unknown error'}`
            );
          }
        }
      }
    }
  }

  // Validate KV and R2 bindings exist
  if (!env.REPORTING_KV) {
    errors.push('REPORTING_KV binding is not configured');
  }

  if (!env.REPORTING_R2) {
    errors.push('REPORTING_R2 binding is not configured');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate that a Stripe price exists using the provided API key
 * Detects mode mismatches by calling Stripe API
 */
async function validateStripePriceExists(
  secretKey: string,
  priceId: string
): Promise<{ valid: boolean; isModeMismatch?: boolean; error?: string }> {
  try {
    const response = await fetch(`https://api.stripe.com/v1/prices/${priceId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (response.ok) {
      return { valid: true };
    }

    const errorData = await response.json() as { error?: { message?: string; type?: string } };
    const errorMessage = errorData.error?.message || 'Unknown error';

    // If price doesn't exist, it's likely a mode mismatch
    if (response.status === 404 || errorMessage.includes('No such price')) {
      return {
        valid: false,
        isModeMismatch: true,
      };
    }

    // Other error (auth failure, network issue, etc.)
    return {
      valid: false,
      error: errorMessage,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Network error calling Stripe API',
    };
  }
}

/**
 * Detect Stripe API key mode (test vs live)
 * Returns 'test', 'live', or null if invalid format
 */
function getStripeKeyMode(stripeKey: string): 'test' | 'live' | null {
  if (stripeKey.startsWith('sk_test_')) {
    return 'test';
  } else if (stripeKey.startsWith('sk_live_')) {
    return 'live';
  }
  return null;
}

/**
 * Check if dev mode bypasses should be enabled
 * Returns true ONLY if REPORTING_ENV is explicitly set to 'dev'
 *
 * Operating Principle: No dev-mode bypasses in production
 */
export function isDevMode(env: Env): boolean {
  return env.REPORTING_ENV === 'dev';
}

/**
 * Check if production mode is active
 * Returns true ONLY if REPORTING_ENV is explicitly set to 'prod'
 */
export function isProductionMode(env: Env): boolean {
  return env.REPORTING_ENV === 'prod';
}

/**
 * Get a configuration value with fallback to default
 * Only returns defaults in development mode
 */
export function getConfigValue<K extends keyof typeof OPTIONAL_WITH_DEFAULTS>(
  env: Env,
  key: K
): string {
  const envValue = env[key];

  if (envValue) {
    return envValue;
  }

  // In production, do not use defaults - fail fast
  if (isProductionMode(env)) {
    throw new Error(`Production requires ${key} but it is not set and no default is available`);
  }

  // In development, use defaults
  return OPTIONAL_WITH_DEFAULTS[key];
}

/**
 * Assert that required secrets exist
 * Throws error if validation fails
 * Use this at application startup
 */
export async function assertValidEnvironment(env: Env): Promise<void> {
  const result = await validateEnvironment(env);

  if (result.warnings.length > 0) {
    console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.warn('⚠️  ENVIRONMENT WARNINGS');
    console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const warning of result.warnings) {
      console.warn(`  - ${warning}`);
    }
    console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  if (!result.valid) {
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('🔴 ENVIRONMENT VALIDATION FAILED');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const error of result.errors) {
      console.error(`  ✗ ${error}`);
    }
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('\nProduction cannot start safely.');
    console.error('Configure required secrets using: wrangler secret put <NAME>\n');

    throw new Error('Environment validation failed - see errors above');
  }

  // Log successful validation in production
  if (isProductionMode(env)) {
    console.log('✓ Environment validation passed - production mode active');
  }
}
