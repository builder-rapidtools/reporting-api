/**
 * KV/R2 storage helpers
 * Abstraction layer for Cloudflare KV and R2 operations
 */

import { Agency, Client, IntegrationConfig, ReportRun } from './types';

/**
 * KV key patterns (as defined in ARCHITECTURE.md):
 *
 * agency:{agencyId}                    → Agency object
 * agency_api_key:{apiKey}              → AgencyId (for lookups by API key)
 * agency:{agencyId}:clients            → Array of Client IDs
 * client:{clientId}                    → Client object
 * client:{clientId}:integration        → IntegrationConfig object
 * client:{clientId}:reports            → Array of ReportRun IDs
 * report:{reportId}                    → ReportRun metadata
 */

export class Storage {
  constructor(private kv: KVNamespace, private r2: R2Bucket) {}

  // Agency operations

  async getAgency(agencyId: string): Promise<Agency | null> {
    const key = `agency:${agencyId}`;
    const data = await this.kv.get(key, 'json');
    return data as Agency | null;
  }

  async getAgencyByApiKey(apiKey: string): Promise<Agency | null> {
    // Lookup agency ID by API key
    const lookupKey = `agency_api_key:${apiKey}`;
    const agencyId = await this.kv.get(lookupKey, 'text');

    if (!agencyId) {
      return null;
    }

    return this.getAgency(agencyId);
  }

  async getAgencyByStripeCustomerId(stripeCustomerId: string): Promise<Agency | null> {
    // Lookup agency ID by Stripe customer ID
    const lookupKey = `agency_stripe_customer:${stripeCustomerId}`;
    const agencyId = await this.kv.get(lookupKey, 'text');

    if (!agencyId) {
      return null;
    }

    return this.getAgency(agencyId);
  }

  async saveAgency(agency: Agency): Promise<void> {
    const agencyKey = `agency:${agency.id}`;
    const apiKeyLookupKey = `agency_api_key:${agency.apiKey}`;

    // Store agency object
    await this.kv.put(agencyKey, JSON.stringify(agency));

    // Store API key lookup (apiKey → agencyId)
    await this.kv.put(apiKeyLookupKey, agency.id);

    // Store Stripe customer ID lookup (if set)
    if (agency.stripeCustomerId) {
      const stripeCustomerLookupKey = `agency_stripe_customer:${agency.stripeCustomerId}`;
      await this.kv.put(stripeCustomerLookupKey, agency.id);
    }
  }

  async createAgency(name: string, billingEmail: string): Promise<Agency> {
    const { v4: uuidv4 } = await import('uuid');

    const now = new Date();
    const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days from now

    const agency: Agency = {
      id: uuidv4(),
      name,
      billingEmail,
      apiKey: uuidv4(), // Generate secure API key
      subscriptionStatus: 'trial',
      subscriptionPlan: 'starter', // Hostile Audit Phase 1: Default to starter
      trialEndsAt: trialEnd.toISOString(), // Hostile Audit Phase 1: 14-day trial
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    await this.saveAgency(agency);

    // Add to agency list for cron iteration
    await this.addToAgencyList(agency.id);

    return agency;
  }

  private async addToAgencyList(agencyId: string): Promise<void> {
    const agencyListJson = await this.kv.get('agency_list', 'json');
    const agencyIds = (agencyListJson as string[]) || [];

    if (!agencyIds.includes(agencyId)) {
      agencyIds.push(agencyId);
      await this.kv.put('agency_list', JSON.stringify(agencyIds));
    }
  }

  async updateAgency(agency: Agency): Promise<void> {
    agency.updatedAt = new Date().toISOString();
    await this.saveAgency(agency);
  }

  // Client operations

  async getClient(clientId: string): Promise<Client | null> {
    const key = `client:${clientId}`;
    const data = await this.kv.get(key, 'json');
    return data as Client | null;
  }

  async saveClient(client: Client): Promise<void> {
    const clientKey = `client:${client.id}`;
    await this.kv.put(clientKey, JSON.stringify(client));

    // Add client ID to agency's client list if not already present
    await this.addClientToAgency(client.agencyId, client.id);
  }

  async listClients(agencyId: string): Promise<Client[]> {
    const clientIdsKey = `agency:${agencyId}:clients`;
    const clientIds = await this.kv.get(clientIdsKey, 'json') as string[] | null;

    if (!clientIds || clientIds.length === 0) {
      return [];
    }

    const clients: Client[] = [];
    for (const clientId of clientIds) {
      const client = await this.getClient(clientId);
      if (client) {
        clients.push(client);
      }
    }

    return clients;
  }

  async deleteClient(clientId: string, options?: { cascade?: boolean }): Promise<void> {
    const client = await this.getClient(clientId);
    if (!client) {
      return;
    }

    // Remove client from agency's client list
    await this.removeClientFromAgency(client.agencyId, clientId);

    // Delete client data
    const clientKey = `client:${clientId}`;
    await this.kv.delete(clientKey);

    // Delete integration config
    const integrationKey = `client:${clientId}:integration`;
    await this.kv.delete(integrationKey);

    // Hostile Audit Phase 4: Cascade delete R2 objects and report metadata
    if (options?.cascade) {
      await this.cascadeDeleteClientData(client.agencyId, clientId);
    }
  }

  /**
   * Hostile Audit Phase 4: Cascade delete all R2 objects and KV report metadata for a client
   * Idempotent: safe to call multiple times, no errors if objects already deleted
   * Phase 4 Hardening: Added guardrails to ensure client-scoped deletion only
   */
  private async cascadeDeleteClientData(agencyId: string, clientId: string): Promise<void> {
    // Phase 4 Hardening: Validate agencyId and clientId to prevent accidental agency-wide deletion
    if (!agencyId || !clientId) {
      console.error('Cannot cascade delete: missing agencyId or clientId');
      return;
    }

    // Ensure IDs don't contain path traversal characters
    if (agencyId.includes('/') || agencyId.includes('..') || clientId.includes('/') || clientId.includes('..')) {
      console.error('Cannot cascade delete: invalid agencyId or clientId (contains path characters)');
      return;
    }

    // Delete all CSV files for this client (client-scoped)
    const csvPrefix = `ga4-csv/${agencyId}/${clientId}/`;
    await this.deleteR2ObjectsByPrefix(csvPrefix);

    // Delete all PDF reports for this client (client-scoped)
    const pdfPrefix = `reports/${agencyId}/${clientId}/`;
    await this.deleteR2ObjectsByPrefix(pdfPrefix);

    // Delete report metadata from KV
    const reportsKey = `client:${clientId}:reports`;
    const reportIds = await this.kv.get(reportsKey, 'json') as string[] | null;

    if (reportIds && reportIds.length > 0) {
      // Delete each report metadata entry
      for (const reportId of reportIds) {
        const reportKey = `report:${reportId}`;
        await this.kv.delete(reportKey);
      }
    }

    // Delete the reports list itself
    await this.kv.delete(reportsKey);
  }

  /**
   * Hostile Audit Phase 4: Delete all R2 objects with a given prefix
   * Idempotent: safe to call multiple times
   * Phase 4 Hardening: Added guardrails to prevent agency-wide deletion
   */
  private async deleteR2ObjectsByPrefix(prefix: string): Promise<void> {
    try {
      // Phase 4 Hardening: Ensure prefix is client-scoped (must contain both agencyId and clientId)
      // Valid patterns: ga4-csv/{agencyId}/{clientId}/ or reports/{agencyId}/{clientId}/
      const validPrefixPattern = /^(ga4-csv|reports)\/[^\/]+\/[^\/]+\/$/;

      if (!validPrefixPattern.test(prefix)) {
        console.error(`Refusing to delete R2 objects: prefix "${prefix}" is not client-scoped`);
        return;
      }

      // List all objects with the prefix
      const listed = await this.r2.list({ prefix });

      if (!listed.objects || listed.objects.length === 0) {
        return;
      }

      // Delete each object
      for (const object of listed.objects) {
        await this.r2.delete(object.key);
      }

      // Handle pagination if there are more objects
      if (listed.truncated) {
        await this.deleteR2ObjectsByPrefix(prefix);
      }
    } catch (error) {
      // Log error but don't throw - cascade delete should be best-effort
      console.error(`Failed to delete R2 objects with prefix ${prefix}:`, error);
    }
  }

  private async addClientToAgency(agencyId: string, clientId: string): Promise<void> {
    const key = `agency:${agencyId}:clients`;
    const existingIds = await this.kv.get(key, 'json') as string[] | null;
    const clientIds = existingIds || [];

    if (!clientIds.includes(clientId)) {
      clientIds.push(clientId);
      await this.kv.put(key, JSON.stringify(clientIds));
    }
  }

  private async removeClientFromAgency(agencyId: string, clientId: string): Promise<void> {
    const key = `agency:${agencyId}:clients`;
    const existingIds = await this.kv.get(key, 'json') as string[] | null;
    if (!existingIds) {
      return;
    }

    const updatedIds = existingIds.filter(id => id !== clientId);
    await this.kv.put(key, JSON.stringify(updatedIds));
  }

  // Integration config operations

  async getIntegrationConfig(clientId: string): Promise<IntegrationConfig | null> {
    const key = `client:${clientId}:integration`;
    const data = await this.kv.get(key, 'json');
    return data as IntegrationConfig | null;
  }

  async saveIntegrationConfig(config: IntegrationConfig): Promise<void> {
    const key = `client:${config.clientId}:integration`;
    await this.kv.put(key, JSON.stringify(config));
  }

  // Report operations

  async getReportRun(reportId: string): Promise<ReportRun | null> {
    const key = `report:${reportId}`;
    const data = await this.kv.get(key, 'json');
    return data as ReportRun | null;
  }

  async saveReportRun(report: ReportRun): Promise<void> {
    const reportKey = `report:${report.id}`;
    await this.kv.put(reportKey, JSON.stringify(report));

    // Add report ID to client's report list
    await this.addReportToClient(report.clientId, report.id);
  }

  async listReports(clientId: string): Promise<ReportRun[]> {
    const reportsKey = `client:${clientId}:reports`;
    const reportIds = await this.kv.get(reportsKey, 'json') as string[] | null;

    if (!reportIds || reportIds.length === 0) {
      return [];
    }

    const reports: ReportRun[] = [];
    for (const reportId of reportIds) {
      const report = await this.getReportRun(reportId);
      if (report) {
        reports.push(report);
      }
    }

    return reports;
  }

  private async addReportToClient(clientId: string, reportId: string): Promise<void> {
    const key = `client:${clientId}:reports`;
    const existingIds = await this.kv.get(key, 'json') as string[] | null;
    const reportIds = existingIds || [];

    if (!reportIds.includes(reportId)) {
      reportIds.push(reportId);
      await this.kv.put(key, JSON.stringify(reportIds));
    }
  }

  // R2 operations for CSV and PDF storage

  async uploadCsvToR2(agencyId: string, clientId: string, csvContent: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key = `ga4-csv/${agencyId}/${clientId}/${timestamp}.csv`;

    await this.r2.put(key, csvContent, {
      httpMetadata: {
        contentType: 'text/csv',
      },
    });

    return key;
  }

  async getCsvFromR2(key: string): Promise<string | null> {
    const object = await this.r2.get(key);
    if (!object) {
      return null;
    }
    return await object.text();
  }

  async uploadPdfToR2(agencyId: string, clientId: string, reportId: string, pdfBuffer: ArrayBuffer): Promise<string> {
    const key = `reports/${agencyId}/${clientId}/${reportId}.pdf`;

    await this.r2.put(key, pdfBuffer, {
      httpMetadata: {
        contentType: 'application/pdf',
      },
    });

    return key;
  }

  // Note: For public PDF URLs, will need to configure R2 public bucket or generate signed URLs
  // This is a placeholder for Phase 2
  getPdfUrl(key: string): string {
    // TODO: Generate proper R2 public URL or signed URL
    return `https://reports.rapidtools.io/${key}`;
  }
}
