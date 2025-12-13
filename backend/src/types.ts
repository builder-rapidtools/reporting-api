/**
 * Core TypeScript types for the Reporting Tool backend
 */

export interface Env {
  REPORTING_KV: KVNamespace;
  REPORTING_R2: R2Bucket;
  REPORTING_ENV?: string;
  AUTOMATION_ENABLED?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID_STARTER?: string;
  EMAIL_PROVIDER_API_KEY?: string;
  EMAIL_FROM_ADDRESS?: string;
  BASE_URL?: string;
  FRONTEND_URL?: string;
  SENTRY_DSN?: string;
}

export type AgencyId = string;
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'canceled';
export type SubscriptionPlan = 'starter' | 'pro';
export type ReportSchedule = 'weekly' | 'biweekly' | 'monthly';
export type ReportStatus = 'pending' | 'generated' | 'sent' | 'failed';

export interface Agency {
  id: AgencyId;
  name: string;
  billingEmail: string;
  apiKey: string; // Secret token for API access
  subscriptionStatus: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export interface Client {
  id: string;
  agencyId: string;
  name: string;
  email: string; // Where report is sent
  brandLogoUrl?: string;
  reportSchedule: ReportSchedule;
  lastReportSentAt?: string; // ISO timestamp
  createdAt: string; // ISO timestamp
}

export interface IntegrationConfig {
  clientId: string;
  ga4CsvLatestKey?: string; // R2 object key for latest CSV
  ga4CsvUploadedAt?: string; // ISO timestamp
  // Future: GA4 OAuth tokens
}

export interface ReportMetrics {
  periodStart: string; // ISO date (YYYY-MM-DD)
  periodEnd: string; // ISO date
  sessions: number;
  users: number;
  pageviews: number;
  topPages: Array<{
    path: string;
    pageviews: number;
  }>;
}

export interface ReportRun {
  id: string;
  clientId: string;
  agencyId: string;
  generatedAt: string; // ISO timestamp
  pdfUrl?: string; // R2 public URL or signed URL
  metrics: ReportMetrics;
  status: ReportStatus;
  emailSentAt?: string; // ISO timestamp
  errorMessage?: string;
}

export interface ReportTemplate {
  agencyId: string;
  templateId: string;
  htmlTemplate: string; // Handlebars/Mustache template
  isDefault: boolean;
}

// CSV upload structure (parsed from GA4 export)
export interface GA4CsvRow {
  date: string; // YYYY-MM-DD
  sessions: number;
  users: number;
  pageviews: number;
  page_path?: string;
  page_views?: number;
}

// API request/response types

export interface CreateClientRequest {
  name: string;
  email: string;
  brandLogoUrl?: string;
  reportSchedule?: ReportSchedule;
}

export interface CreateClientResponse {
  success: boolean;
  client?: Client;
  error?: string;
}

export interface ListClientsResponse {
  success: boolean;
  clients?: Client[];
  error?: string;
}

export interface UploadGA4CsvResponse {
  success: boolean;
  uploadedAt?: string;
  rowsProcessed?: number;
  error?: string;
}

export interface ReportPreviewResponse {
  success: boolean;
  preview?: {
    client: Client;
    metrics: ReportMetrics;
    generatedAt: string;
  };
  error?: string;
}

export interface HealthCheckResponse {
  status: 'ok' | 'error';
  env: string;
  timestamp: string;
}

// Agency API types

export interface RegisterAgencyRequest {
  name: string;
  billingEmail: string;
}

export interface RegisterAgencyResponse {
  success: boolean;
  agency?: {
    id: string;
    name: string;
    billingEmail: string;
    apiKey: string;
    subscriptionStatus: SubscriptionStatus;
    createdAt: string;
  };
  error?: string;
}

export interface GetAgencyResponse {
  success: boolean;
  agency?: Omit<Agency, 'apiKey'>; // Never return API key in GET
  error?: string;
}

export interface CreateCheckoutSessionResponse {
  success: boolean;
  checkoutUrl?: string;
  sessionId?: string;
  error?: string;
}
