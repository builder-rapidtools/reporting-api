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
export function validateEnvironment(env: Env): ValidationResult {
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
export function assertValidEnvironment(env: Env): void {
  const result = validateEnvironment(env);

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
