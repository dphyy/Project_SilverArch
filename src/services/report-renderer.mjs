import PDFDocument from "pdfkit";
import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, PageNumber, Packer,
  Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType
} from "docx";
import { formatSeconds } from "../domain/report.mjs";

const NAVY = "17365D";
const TEAL = "076B68";
const MUTED = "5F6B76";
const LIGHT = "F2F4F7";
const RED = "9B1C1C";
const A4 = { width: 11906, height: 16838, margin: 1134, content: 9518 };

const text = (value) => String(value ?? "").trim() || "Not provided";
const body = (value, options = {}) => new Paragraph({ spacing: { after: 80, line: 252 }, ...options, children: [new TextRun({ text: text(value), font: "Arial", size: 21, color: "202A33" })] });
const heading = (value) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 220, after: 80 }, children: [new TextRun({ text: value, font: "Arial", size: 26, bold: true, color: NAVY })] });
const subheading = (value) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 140, after: 60 }, children: [new TextRun({ text: value, font: "Arial", size: 22, bold: true, color: TEAL })] });

function infoTable(rows) {
  const borders = { top: { style: BorderStyle.SINGLE, color: "D5DCE3", size: 4 }, bottom: { style: BorderStyle.SINGLE, color: "D5DCE3", size: 4 }, left: { style: BorderStyle.SINGLE, color: "D5DCE3", size: 4 }, right: { style: BorderStyle.SINGLE, color: "D5DCE3", size: 4 }, insideHorizontal: { style: BorderStyle.SINGLE, color: "E5E9ED", size: 3 }, insideVertical: { style: BorderStyle.SINGLE, color: "E5E9ED", size: 3 } };
  return new Table({ width: { size: A4.content, type: WidthType.DXA }, columnWidths: [2600, 6918], borders, rows: rows.map(([label, value]) => new TableRow({ children: [
    new TableCell({ width: { size: 2600, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, shading: { type: ShadingType.CLEAR, fill: LIGHT }, children: [new Paragraph({ children: [new TextRun({ text: label, font: "Arial", size: 19, bold: true, color: NAVY })] })] }),
    new TableCell({ width: { size: 6918, type: WidthType.DXA }, margins: { top: 100, bottom: 100, left: 140, right: 140 }, children: [new Paragraph({ children: [new TextRun({ text: text(value), font: "Arial", size: 19, color: "202A33" })] })] })
  ] })) });
}

function evidenceParagraph(item) {
  return new Paragraph({ spacing: { after: 80 }, indent: { left: 280, hanging: 280 }, children: [
    new TextRun({ text: `${formatSeconds(item.start)}  `, font: "Arial", size: 19, bold: true, color: TEAL }),
    new TextRun({ text: `${item.label}: “${item.text}”${item.requiresVerification ? " (verify)" : ""}`, font: "Arial", size: 19, color: "202A33" })
  ] });
}

export async function renderReportDocx(report) {
  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: "SILVERARCH", font: "Arial", size: 20, bold: true, color: TEAL, characterSpacing: 80 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: "Supporting Case Report for SSO Review", font: "Arial", size: 34, bold: true, color: NAVY })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 180 }, children: [new TextRun({ text: report.status === "draft" ? "DRAFT - FOR OFFICER REVIEW" : "FINALIZED SUPPORTING REPORT", font: "Arial", size: 20, bold: true, color: report.status === "draft" ? RED : TEAL })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, shading: { type: ShadingType.CLEAR, fill: "FFF2CC" }, children: [new TextRun({ text: "Sensitive personal data - authorised review only", font: "Arial", size: 18, bold: true, color: "6B5300" })] }),
    infoTable([["Case ID", report.caseId], ["Report version", report.version], ["Prepared", formatDate(report.updatedAt)], ["Officer", `${report.preparedBy.name}, ${report.preparedBy.designation}`], ["Social Service Office", report.preparedBy.sso]]),
    heading("1. Applicant and contact"),
    infoTable([["Callback number", report.applicant.contactPhone], ["Verified summary", report.applicant.summary]]),
    heading("2. Presenting circumstances"), body(report.sections.presentingCircumstances),
    heading("3. Verified facts"),
    infoTable(Object.values(report.facts).map((fact) => [fact.label, fact.status === "unknown" ? `Unable to verify / not provided - ${fact.explanation}` : fact.value])),
    heading("4. Officer assessment"), body(report.sections.assessment),
    heading("5. Recommended follow-up"), body(report.sections.recommendedFollowUp)
  ];
  if (report.sections.safeguardsResolution) children.push(heading("6. Safeguards and review flags"), body(report.sections.safeguardsResolution));
  children.push(heading("7. Schemes for consideration"), body("The following schemes are presented for officer consideration only. This report does not determine eligibility."));
  for (const scheme of report.schemes) {
    children.push(subheading(scheme.name), body(scheme.reasoning));
    for (const item of scheme.appealRelevant) children.push(body(`Appeal-relevant context: ${item}`, { indent: { left: 280 } }));
    for (const item of scheme.insufficientInformation) children.push(body(`Unverified information: ${item}`, { indent: { left: 280 } }));
  }
  children.push(heading("8. Evidence excerpts"));
  if (report.evidence.length) children.push(...report.evidence.map(evidenceParagraph)); else children.push(body("No evidence excerpts were retained."));
  children.push(heading("Appendix A - Verified transcript"), body(report.transcripts.verified));
  if (report.transcripts.english && report.transcripts.english !== report.transcripts.verified) children.push(heading("Appendix B - English translation"), body(report.transcripts.english));
  if (report.transcripts.original !== report.transcripts.verified) children.push(heading("Appendix C - Original ASR transcript"), body(report.transcripts.original));
  children.push(heading("Provider attribution"), body(`ASR: ${report.metadata.asrEngine}. Translation: ${report.metadata.translationStatus}${report.metadata.translationProvider ? ` (${report.metadata.translationProvider})` : ""}.`), heading("Officer declaration"), body(report.declaration.statement));

  const doc = new Document({
    creator: "", lastModifiedBy: "", title: "SilverArch Supporting Case Report", subject: "Supporting case report for SSO review",
    styles: { default: { document: { run: { font: "Arial", size: 21, color: "202A33" }, paragraph: { spacing: { after: 80, line: 252 } } } }, paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial", size: 26, bold: true, color: NAVY }, paragraph: { spacing: { before: 220, after: 80 }, keepNext: true } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial", size: 22, bold: true, color: TEAL }, paragraph: { spacing: { before: 140, after: 60 }, keepNext: true } }
    ] },
    sections: [{ properties: { page: { size: { width: A4.width, height: A4.height }, margin: { top: A4.margin, right: A4.margin, bottom: A4.margin, left: A4.margin, header: 560, footer: 560 } } }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `SilverArch case ${report.caseId.slice(0, 8)} | Version ${report.version} | Page `, font: "Arial", size: 16, color: MUTED }), new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: MUTED })] })] }) }, children }]
  });
  return Packer.toBuffer(doc);
}

export async function renderReportPdf(report) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: "A4", margins: { top: 56.7, right: 56.7, bottom: 64, left: 56.7 }, bufferPages: true, info: { Title: "SilverArch Supporting Case Report", Author: "", Subject: "Supporting case report for SSO review" } });
    doc.on("data", (chunk) => chunks.push(chunk)); doc.on("error", reject); doc.on("end", () => resolve(Buffer.concat(chunks)));
    const pageWidth = 595.28; const contentWidth = pageWidth - 113.4;
    const checkSpace = (height = 80) => { if (doc.y + height > 770) doc.addPage(); };
    const h1 = (value) => { checkSpace(55); doc.moveDown(.5).font("Helvetica-Bold").fontSize(15).fillColor(`#${NAVY}`).text(value, { keepTogether: true }).moveDown(.35); };
    const h2 = (value) => { checkSpace(40); doc.font("Helvetica-Bold").fontSize(12).fillColor(`#${TEAL}`).text(value, { keepTogether: true }).moveDown(.25); };
    const para = (value) => { doc.font("Helvetica").fontSize(10.5).fillColor("#202A33").text(text(value), { lineGap: 2 }).moveDown(.55); };
    const row = (label, value) => { checkSpace(44); const y = doc.y; const labelWidth = 142; const valueWidth = contentWidth - labelWidth; const labelHeight = doc.heightOfString(label, { width: labelWidth - 14 }); const valueText = text(value); const valueHeight = doc.heightOfString(valueText, { width: valueWidth - 14 }); const height = Math.max(30, labelHeight, valueHeight) + 14; doc.rect(56.7, y, labelWidth, height).fillAndStroke(`#${LIGHT}`, "#D5DCE3"); doc.rect(56.7 + labelWidth, y, valueWidth, height).fillAndStroke("#FFFFFF", "#D5DCE3"); doc.fillColor(`#${NAVY}`).font("Helvetica-Bold").fontSize(9.5).text(label, 63.7, y + 7, { width: labelWidth - 14 }); doc.fillColor("#202A33").font("Helvetica").text(valueText, 63.7 + labelWidth, y + 7, { width: valueWidth - 14 }); doc.y = y + height; };

    doc.font("Helvetica-Bold").fontSize(10).fillColor(`#${TEAL}`).text("S I L V E R A R C H", { align: "center" }).moveDown(.7);
    doc.font("Helvetica-Bold").fontSize(20).fillColor(`#${NAVY}`).text("Supporting Case Report for SSO Review", { align: "center" }).moveDown(.5);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(report.status === "draft" ? `#${RED}` : `#${TEAL}`).text(report.status === "draft" ? "DRAFT - FOR OFFICER REVIEW" : "FINALIZED SUPPORTING REPORT", { align: "center" }).moveDown(.8);
    doc.roundedRect(135, doc.y, 325, 25, 4).fill("#FFF2CC"); doc.fillColor("#6B5300").font("Helvetica-Bold").fontSize(9).text("Sensitive personal data - authorised review only", 140, doc.y + 7, { width: 315, align: "center" }); doc.moveDown(2.3);
    [["Case ID", report.caseId], ["Report version", report.version], ["Prepared", formatDate(report.updatedAt)], ["Officer", `${report.preparedBy.name}, ${report.preparedBy.designation}`], ["Social Service Office", report.preparedBy.sso]].forEach(([a, b]) => row(a, b));
    h1("1. Applicant and contact"); row("Callback number", report.applicant.contactPhone); row("Verified summary", report.applicant.summary);
    h1("2. Presenting circumstances"); para(report.sections.presentingCircumstances);
    h1("3. Verified facts"); Object.values(report.facts).forEach((fact) => row(fact.label, fact.status === "unknown" ? `Unable to verify / not provided - ${fact.explanation}` : fact.value));
    h1("4. Officer assessment"); para(report.sections.assessment);
    h1("5. Recommended follow-up"); para(report.sections.recommendedFollowUp);
    if (report.sections.safeguardsResolution) { h1("6. Safeguards and review flags"); para(report.sections.safeguardsResolution); }
    h1("7. Schemes for consideration"); para("The following schemes are presented for officer consideration only. This report does not determine eligibility.");
    for (const scheme of report.schemes) { h2(scheme.name); para(scheme.reasoning); scheme.appealRelevant.forEach((item) => para(`Appeal-relevant context: ${item}`)); scheme.insufficientInformation.forEach((item) => para(`Unverified information: ${item}`)); }
    h1("8. Evidence excerpts"); if (report.evidence.length) report.evidence.forEach((item) => para(`${formatSeconds(item.start)} - ${item.label}: “${item.text}”${item.requiresVerification ? " (verify)" : ""}`)); else para("No evidence excerpts were retained.");
    h1("Appendix A - Verified transcript"); para(report.transcripts.verified);
    if (report.transcripts.english && report.transcripts.english !== report.transcripts.verified) { h1("Appendix B - English translation"); para(report.transcripts.english); }
    if (report.transcripts.original !== report.transcripts.verified) { h1("Appendix C - Original ASR transcript"); para(report.transcripts.original); }
    h1("Provider attribution"); para(`ASR: ${report.metadata.asrEngine}. Translation: ${report.metadata.translationStatus}${report.metadata.translationProvider ? ` (${report.metadata.translationProvider})` : ""}.`);
    h1("Officer declaration"); para(report.declaration.statement);
    const range = doc.bufferedPageRange(); for (let i = range.start; i < range.start + range.count; i += 1) { doc.switchToPage(i); doc.font("Helvetica").fontSize(8).fillColor(`#${MUTED}`).text(`SilverArch case ${report.caseId.slice(0, 8)} | Version ${report.version} | Page ${i + 1} of ${range.count}`, 56.7, 768, { width: contentWidth, align: "right", lineBreak: false }); }
    doc.end();
  });
}

export function formatDate(value) {
  try { return new Intl.DateTimeFormat("en-SG", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" }).format(new Date(value)); }
  catch { return String(value || ""); }
}
