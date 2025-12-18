/**
 * PDF Download Handler
 * Serves PDF reports from R2 storage
 */

import { Context } from 'hono';
import { Env } from '../types';

/**
 * Handle PDF download requests
 * Supports both:
 * - /reports/:agencyId/:clientId/:filename
 * - /reports/reports/:agencyId/:clientId/:filename (for backwards compatibility)
 */
export async function handlePdfDownload(c: Context): Promise<Response> {
  try {
    const env = c.env as Env;
    const { agencyId, clientId, filename } = c.req.param();

    // Validate required params
    if (!agencyId || !clientId || !filename) {
      console.log('[PDF Download] Missing required params:', { agencyId, clientId, filename });
      return c.json({
        success: false,
        error: 'Invalid PDF URL',
      }, 400);
    }

    // Validate filename is a PDF
    if (!filename.endsWith('.pdf')) {
      console.log('[PDF Download] Invalid filename (not PDF):', filename);
      return c.json({
        success: false,
        error: 'Invalid file type',
      }, 400);
    }

    // Construct R2 key
    const r2Key = `reports/${agencyId}/${clientId}/${filename}`;

    // Fetch PDF from R2
    const object = await env.REPORTING_R2.get(r2Key);

    if (!object) {
      console.log('[PDF Download] PDF not found in R2:', {
        r2Key,
        agencyId,
        clientId,
        filename,
      });
      return c.json({
        success: false,
        error: 'Report not found',
      }, 404);
    }

    // Stream the PDF with proper headers
    return new Response(object.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year (immutable content)
      },
    });
  } catch (error) {
    console.error('[PDF Download] Error:', error);
    return c.json({
      success: false,
      error: 'Failed to retrieve report',
    }, 500);
  }
}
