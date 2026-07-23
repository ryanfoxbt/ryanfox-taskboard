// Renders the plain-text tailored resume/cover-letter drafts (written by the
// tailor-application skill) into nicely formatted .docx files for download or
// direct upload to an application form. Parsing is heuristic, tuned to the
// plain-text conventions those drafts are actually written in (name on line 1,
// contact info on line 2, ALL-CAPS section headers, "- " bullets, "Title |
// Company | Dates" role headers) - not a general-purpose text-to-docx engine.
const {
    Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, HeadingLevel
} = require('docx');

const ACCENT_COLOR = '1F4E5F';
const MUTED_COLOR = '5E6C84';

function isAllCapsHeader(line) {
    const trimmed = line.trim();
    if (trimmed.length < 3 || trimmed.length > 60) return false;
    if (trimmed.startsWith('-')) return false;
    const letters = trimmed.replace(/[^A-Za-z]/g, '');
    if (letters.length < 3) return false;
    return letters === letters.toUpperCase();
}

function isRoleHeaderLine(line) {
    return (line.match(/\|/g) || []).length >= 1 && line.length < 140 && !line.trim().startsWith('-');
}

function buildResumeDoc(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const children = [];
    let firstNonBlankSeen = 0;

    lines.forEach((raw, idx) => {
        const line = raw.trimEnd();
        const trimmed = line.trim();

        if (trimmed === '') {
            if (children.length > 0) children.push(new Paragraph({ text: '', spacing: { after: 60 } }));
            return;
        }

        firstNonBlankSeen++;
        if (firstNonBlankSeen === 1) {
            // Name
            children.push(new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 60 },
                children: [new TextRun({ text: trimmed, bold: true, size: 40, color: ACCENT_COLOR })]
            }));
            return;
        }
        if (firstNonBlankSeen === 2) {
            // Contact line
            children.push(new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 },
                border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 8 } },
                children: [new TextRun({ text: trimmed, size: 18, color: MUTED_COLOR })]
            }));
            return;
        }

        if (isAllCapsHeader(trimmed)) {
            children.push(new Paragraph({
                spacing: { before: 240, after: 100 },
                border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: ACCENT_COLOR, space: 2 } },
                children: [new TextRun({ text: trimmed.toUpperCase(), bold: true, size: 22, color: ACCENT_COLOR })]
            }));
            return;
        }

        if (trimmed.startsWith('- ')) {
            children.push(new Paragraph({
                bullet: { level: 0 },
                spacing: { after: 80 },
                children: [new TextRun({ text: trimmed.slice(2), size: 21 })]
            }));
            return;
        }

        if (isRoleHeaderLine(trimmed)) {
            children.push(new Paragraph({
                spacing: { before: 120, after: 60 },
                children: [new TextRun({ text: trimmed, bold: true, size: 22 })]
            }));
            return;
        }

        children.push(new Paragraph({
            spacing: { after: 100 },
            children: [new TextRun({ text: trimmed, size: 21 })]
        }));
    });

    const doc = new Document({
        sections: [{ properties: {}, children }]
    });
    return Packer.toBuffer(doc);
}

function buildCoverLetterDoc(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const children = [];
    let firstNonBlankSeen = 0;

    lines.forEach((raw) => {
        const line = raw.trimEnd();
        const trimmed = line.trim();

        if (trimmed === '') {
            children.push(new Paragraph({ text: '', spacing: { after: 100 } }));
            return;
        }

        firstNonBlankSeen++;
        if (firstNonBlankSeen === 1) {
            children.push(new Paragraph({
                spacing: { after: 20 },
                children: [new TextRun({ text: trimmed, bold: true, size: 24 })]
            }));
            return;
        }

        children.push(new Paragraph({
            spacing: { after: 160 },
            children: [new TextRun({ text: trimmed, size: 22 })]
        }));
    });

    const doc = new Document({
        sections: [{ properties: {}, children }]
    });
    return Packer.toBuffer(doc);
}

function safeFilenamePart(s) {
    return String(s || 'Untitled').replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '_');
}

module.exports = { buildResumeDoc, buildCoverLetterDoc, safeFilenamePart };
