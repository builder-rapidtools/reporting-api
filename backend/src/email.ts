/**
 * Email Abstraction Module
 * Provider-agnostic email sending with dev mode support
 *
 * Operating Principle: Observability over automation
 * Dev mode logs instead of sending to prevent accidental emails
 */

import { Env } from './types';
import { isDevMode } from './env-validator';

export interface EmailSendResult {
  success: boolean;
  provider?: string;
  messageId?: string;
  devMode?: boolean;
  error?: string;
}

export interface SendReportEmailParams {
  to: string;
  subject: string;
  htmlSummary: string;
  pdfKey?: string;
}

/**
 * Send a report email via configured provider
 * Falls back to dev mode logging if no provider is configured
 */
export async function sendReportEmail(
  env: Env,
  params: SendReportEmailParams
): Promise<EmailSendResult> {
  const { to, subject, htmlSummary, pdfKey } = params;

  const apiKey = env.EMAIL_PROVIDER_API_KEY;
  const fromAddress = env.EMAIL_FROM_ADDRESS || 'reports@rapidtools.io';
  const baseUrl = env.BASE_URL || 'https://app.rapidtools.io';

  // Dev mode: No provider configured
  if (isDevMode(env) && !apiKey) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 EMAIL (DEV MODE - NOT SENT)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`To: ${to}`);
    console.log(`From: ${fromAddress}`);
    console.log(`Subject: ${subject}`);
    console.log(`PDF Key: ${pdfKey || 'N/A'}`);
    console.log('-------------------------------------------');
    console.log('HTML Summary:');
    console.log(htmlSummary);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return {
      success: true,
      devMode: true,
    };
  }

  // Production mode: Use Resend as default provider
  // Can be swapped for Postmark, SendGrid, or SES by changing implementation
  try {
    const result = await sendViaResend(env, {
      to,
      from: fromAddress,
      subject,
      htmlBody: htmlSummary,
      pdfKey,
    });

    return result;
  } catch (error) {
    console.error('Email send failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send email via Resend
 * https://resend.com/docs/api-reference/emails/send-email
 */
async function sendViaResend(
  env: Env,
  params: {
    to: string;
    from: string;
    subject: string;
    htmlBody: string;
    pdfKey?: string;
  }
): Promise<EmailSendResult> {
  const { to, from, subject, htmlBody, pdfKey } = params;

  // TODO: If pdfKey is provided, fetch PDF from R2 and attach
  // For MVP Phase 2, we'll include a link to the PDF instead of attaching it

  let html = htmlBody;

  // If PDF exists, add download link
  if (pdfKey) {
    const baseUrl = env.BASE_URL || 'https://app.rapidtools.io';
    const pdfUrl = `${baseUrl}/reports/${pdfKey}`;
    html += `
      <br><br>
      <div style="margin-top: 20px; padding: 15px; background: #f5f5f5; border-radius: 5px;">
        <p style="margin: 0 0 10px 0; font-weight: bold;">📊 View Full Report</p>
        <a href="${pdfUrl}" style="display: inline-block; padding: 10px 20px; background: #3b82f6; color: white; text-decoration: none; border-radius: 5px;">
          Download PDF Report
        </a>
      </div>
    `;
  }

  const payload = {
    from,
    to: [to],
    subject,
    html,
  };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.EMAIL_PROVIDER_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json() as any;

  if (!response.ok) {
    throw new Error(`Resend API error: ${data.message || response.statusText}`);
  }

  return {
    success: true,
    provider: 'resend',
    messageId: data.id,
  };
}

/**
 * Build HTML summary for a report email
 */
export function buildReportEmailHtml(params: {
  clientName: string;
  periodStart: string;
  periodEnd: string;
  sessions: number;
  users: number;
  pageviews: number;
  topPages: Array<{ path: string; pageviews: number }>;
}): string {
  const { clientName, periodStart, periodEnd, sessions, users, pageviews, topPages } = params;

  const topPagesHtml = topPages
    .slice(0, 5)
    .map(
      (page, idx) => `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 10px; color: #6b7280;">${idx + 1}</td>
        <td style="padding: 10px; color: #1f2937;">${page.path}</td>
        <td style="padding: 10px; text-align: right; color: #1f2937; font-weight: 600;">${page.pageviews.toLocaleString()}</td>
      </tr>
    `
    )
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Traffic Report</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 30px; text-align: center;">
              <h1 style="margin: 0; color: white; font-size: 28px; font-weight: 700;">Weekly Traffic Report</h1>
              <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">${clientName}</p>
            </td>
          </tr>

          <!-- Period -->
          <tr>
            <td style="padding: 20px 30px; text-align: center; background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                <strong>Period:</strong> ${periodStart} to ${periodEnd}
              </p>
            </td>
          </tr>

          <!-- Key Metrics -->
          <tr>
            <td style="padding: 30px;">
              <h2 style="margin: 0 0 20px 0; color: #1f2937; font-size: 20px;">📊 Key Metrics</h2>

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="33%" style="padding: 15px; text-align: center; background: #eff6ff; border-radius: 6px;">
                    <div style="font-size: 32px; font-weight: 700; color: #3b82f6; margin-bottom: 5px;">${sessions.toLocaleString()}</div>
                    <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Sessions</div>
                  </td>
                  <td width="10"></td>
                  <td width="33%" style="padding: 15px; text-align: center; background: #f0fdf4; border-radius: 6px;">
                    <div style="font-size: 32px; font-weight: 700; color: #10b981; margin-bottom: 5px;">${users.toLocaleString()}</div>
                    <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Users</div>
                  </td>
                  <td width="10"></td>
                  <td width="33%" style="padding: 15px; text-align: center; background: #fef3c7; border-radius: 6px;">
                    <div style="font-size: 32px; font-weight: 700; color: #f59e0b; margin-bottom: 5px;">${pageviews.toLocaleString()}</div>
                    <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Pageviews</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Top Pages -->
          <tr>
            <td style="padding: 0 30px 30px 30px;">
              <h2 style="margin: 0 0 15px 0; color: #1f2937; font-size: 20px;">🔝 Top Pages</h2>

              <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden;">
                <thead>
                  <tr style="background: #f9fafb;">
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; width: 40px;">#</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Page Path</th>
                    <th style="padding: 12px; text-align: right; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Views</th>
                  </tr>
                </thead>
                <tbody>
                  ${topPagesHtml}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 30px; text-align: center; background: #f9fafb; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                Powered by <strong>RapidTools</strong>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
