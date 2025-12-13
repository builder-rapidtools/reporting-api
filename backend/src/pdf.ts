/**
 * PDF Generation Module
 * Generates branded PDF reports from metrics data
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Env, Client, ReportMetrics } from './types';

export interface ReportPreviewData {
  client: Client;
  metrics: ReportMetrics;
  generatedAt: string;
}

export interface GeneratedReport {
  pdfKey: string;
  bucket: string;
  generatedAt: string;
  sizeBytes: number;
}

/**
 * Generate a branded PDF report and store it in R2
 */
export async function generateAndStoreReportPDF(
  env: Env,
  preview: ReportPreviewData
): Promise<GeneratedReport> {
  const { client, metrics, generatedAt } = preview;

  // Create PDF document
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4 size in points
  const { width, height } = page.getSize();

  // Load fonts
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Colors
  const primaryColor = rgb(0.2, 0.3, 0.5); // Dark blue
  const textColor = rgb(0.2, 0.2, 0.2); // Dark gray
  const accentColor = rgb(0.3, 0.5, 0.8); // Light blue

  let yPosition = height - 80;

  // Title
  page.drawText('Weekly Traffic Report', {
    x: 50,
    y: yPosition,
    size: 28,
    font: boldFont,
    color: primaryColor,
  });

  yPosition -= 50;

  // Client name
  page.drawText(client.name, {
    x: 50,
    y: yPosition,
    size: 18,
    font: boldFont,
    color: textColor,
  });

  yPosition -= 30;

  // Period
  const periodText = `Period: ${metrics.periodStart} to ${metrics.periodEnd}`;
  page.drawText(periodText, {
    x: 50,
    y: yPosition,
    size: 12,
    font: regularFont,
    color: textColor,
  });

  yPosition -= 40;

  // Divider line
  page.drawLine({
    start: { x: 50, y: yPosition },
    end: { x: width - 50, y: yPosition },
    thickness: 1,
    color: accentColor,
  });

  yPosition -= 40;

  // Key Metrics Section
  page.drawText('Key Metrics', {
    x: 50,
    y: yPosition,
    size: 16,
    font: boldFont,
    color: primaryColor,
  });

  yPosition -= 30;

  // Metrics grid
  const metricsData = [
    { label: 'Total Sessions', value: metrics.sessions.toLocaleString() },
    { label: 'Total Users', value: metrics.users.toLocaleString() },
    { label: 'Total Pageviews', value: metrics.pageviews.toLocaleString() },
  ];

  const columnWidth = 150;
  let xPosition = 50;

  for (const metric of metricsData) {
    // Metric box background
    page.drawRectangle({
      x: xPosition,
      y: yPosition - 45,
      width: columnWidth,
      height: 55,
      color: rgb(0.95, 0.97, 1),
      borderColor: accentColor,
      borderWidth: 1,
    });

    // Metric value
    page.drawText(metric.value, {
      x: xPosition + 10,
      y: yPosition - 20,
      size: 20,
      font: boldFont,
      color: primaryColor,
    });

    // Metric label
    page.drawText(metric.label, {
      x: xPosition + 10,
      y: yPosition - 40,
      size: 10,
      font: regularFont,
      color: textColor,
    });

    xPosition += columnWidth + 20;
  }

  yPosition -= 80;

  // Top Pages Section
  page.drawText('Top Pages', {
    x: 50,
    y: yPosition,
    size: 16,
    font: boldFont,
    color: primaryColor,
  });

  yPosition -= 30;

  // Table header
  page.drawRectangle({
    x: 50,
    y: yPosition - 20,
    width: width - 100,
    height: 25,
    color: rgb(0.9, 0.93, 0.97),
  });

  page.drawText('Page Path', {
    x: 60,
    y: yPosition - 12,
    size: 11,
    font: boldFont,
    color: primaryColor,
  });

  page.drawText('Pageviews', {
    x: width - 150,
    y: yPosition - 12,
    size: 11,
    font: boldFont,
    color: primaryColor,
  });

  yPosition -= 25;

  // Top pages rows (limit to 10)
  const topPages = metrics.topPages.slice(0, 10);
  let rowIndex = 0;

  for (const page of topPages) {
    yPosition -= 25;

    // Alternating row background
    if (rowIndex % 2 === 0) {
      pdfDoc.getPages()[0].drawRectangle({
        x: 50,
        y: yPosition - 15,
        width: width - 100,
        height: 25,
        color: rgb(0.98, 0.99, 1),
      });
    }

    // Page path (truncate if too long)
    const pathText = page.path.length > 50 ? page.path.substring(0, 47) + '...' : page.path;
    pdfDoc.getPages()[0].drawText(pathText, {
      x: 60,
      y: yPosition - 7,
      size: 10,
      font: regularFont,
      color: textColor,
    });

    // Pageviews
    pdfDoc.getPages()[0].drawText(page.pageviews.toLocaleString(), {
      x: width - 150,
      y: yPosition - 7,
      size: 10,
      font: regularFont,
      color: textColor,
    });

    rowIndex++;
  }

  // Footer
  const footerY = 50;
  pdfDoc.getPages()[0].drawText(`Generated on ${new Date(generatedAt).toLocaleDateString()}`, {
    x: 50,
    y: footerY,
    size: 9,
    font: regularFont,
    color: rgb(0.5, 0.5, 0.5),
  });

  pdfDoc.getPages()[0].drawText('Powered by RapidTools', {
    x: width - 150,
    y: footerY,
    size: 9,
    font: regularFont,
    color: rgb(0.5, 0.5, 0.5),
  });

  // Generate PDF bytes
  const pdfBytes = await pdfDoc.save();

  // Generate R2 key
  const timestamp = new Date(generatedAt).toISOString().replace(/[:.]/g, '-');
  const pdfKey = `reports/${client.agencyId}/${client.id}/${timestamp}.pdf`;

  // Store in R2
  await env.REPORTING_R2.put(pdfKey, pdfBytes, {
    httpMetadata: {
      contentType: 'application/pdf',
    },
    customMetadata: {
      clientId: client.id,
      agencyId: client.agencyId,
      periodStart: metrics.periodStart,
      periodEnd: metrics.periodEnd,
      generatedAt,
    },
  });

  return {
    pdfKey,
    bucket: 'rapidtools-reports',
    generatedAt,
    sizeBytes: pdfBytes.length,
  };
}

/**
 * Retrieve a PDF URL from R2
 * Note: For MVP, returns a placeholder URL
 * TODO: Implement R2 public access or signed URLs in production
 */
export function getPdfUrl(baseUrl: string, pdfKey: string): string {
  // In production, this would return a signed URL or public R2 URL
  // For now, return a placeholder that indicates where the PDF is stored
  return `${baseUrl}/reports/${pdfKey}`;
}
