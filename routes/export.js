const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const express = require('express');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  HeadingLevel,
  AlignmentType,
  ShadingType,
  ImageRun
} = require('docx');
const { getDb } = require('../db');
const { COLLECTIONS } = require('../constants');
const { canonicalStatus } = require('../utils/status');

const router = express.Router();

// ---------- MYRUNTIME brand assets (per-event Equipment List only) ----------
// The rest of this app is ITEMHOUND-branded - this one document deliberately
// carries MYRUNTIME's brand instead, per that brand's guidelines (palette,
// DM Sans/Inter typefaces, horizontal logo). Assets are copied into this repo
// (not read from any external/session-specific path) so the running server
// doesn't depend on anything outside its own codebase.
const MYRUNTIME_ASSETS_DIR = path.join(__dirname, '..', 'assets', 'branding', 'myruntime');
const MYRUNTIME_COLORS = {
  navy: '052941',
  orange: 'FC6B25',
  teal: '1E4E65',
  lightGray: 'ECECEC',
  white: 'FFFFFF'
};
// Loaded once at startup rather than per-request.
const myruntimeLogoBuffer = fs.readFileSync(path.join(MYRUNTIME_ASSETS_DIR, 'horizontal-logo-color.png'));
const myruntimeFonts = [
  { name: 'DM Sans', data: fs.readFileSync(path.join(MYRUNTIME_ASSETS_DIR, 'fonts', 'DMSans-VariableFont_opsz_wght.ttf')) },
  { name: 'Inter', data: fs.readFileSync(path.join(MYRUNTIME_ASSETS_DIR, 'fonts', 'Inter-VariableFont_opsz_wght.ttf')) }
];
// Actual logo file is 2999x764 (ratio ~3.925:1) - scaled down keeping that
// exact ratio, never set independently, per the brand's logo rules.
const MYRUNTIME_LOGO_WIDTH = 220;
const MYRUNTIME_LOGO_HEIGHT = Math.round(MYRUNTIME_LOGO_WIDTH / (2999 / 764));

// The `docx` package writes embedded font *data* and the fontTable.xml
// relationships correctly, but doesn't set the document-level flag that
// tells Word to actually load embedded fonts on open rather than silently
// substitute/ignore them. Patch that in as a small post-processing pass over
// the already-built .docx (itself just a zip archive) - this is the
// "actually embed the fonts" step, not just naming them.
async function embedFontsFlag(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const settingsFile = zip.file('word/settings.xml');
  if (!settingsFile) return buffer;

  const settingsXml = await settingsFile.async('string');
  if (settingsXml.includes('embedTrueTypeFonts')) return buffer;

  const patched = settingsXml.replace(/(<w:settings[^>]*>)/, '$1<w:embedTrueTypeFonts w:val="true"/>');
  zip.file('word/settings.xml', patched);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function headerCell(text, widthPercent) {
  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, fill: 'DDDDDD' },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })]
  });
}

function cell(text, widthPercent) {
  return new TableCell({
    width: { size: widthPercent, type: WidthType.PERCENTAGE },
    children: [new Paragraph(text && String(text).length > 0 ? String(text) : '-')]
  });
}

// GET /api/export/:employeeId - builds a .docx listing everything currently
// borrowed by the employee plus any not-yet-exported miscellaneous items,
// then streams it back as a file download.
router.get('/:employeeId', async (req, res) => {
  try {
    const db = getDb();
    const employeeId = req.params.employeeId.trim();
    const employee = await db.collection(COLLECTIONS.EMPLOYEES).findOne({ employeeId });
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found.' });
    }

    const equipmentList = await db
      .collection(COLLECTIONS.EQUIPMENT)
      .find({ employeeId, status: 'Unavailable' })
      .sort({ equipmentId: 1 })
      .toArray();

    const miscList = await db
      .collection(COLLECTIONS.MISC_LOGS)
      .find({ employeeId, exported: false })
      .sort({ createdAt: 1 })
      .toArray();

    const children = [
      new Paragraph({
        text: 'Equipment Borrow Record',
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER
      }),
      new Paragraph({ text: `Employee: ${employee.name} (${employee.employeeId})`, spacing: { after: 100 } }),
      new Paragraph({ text: `Date generated: ${new Date().toLocaleString()}`, spacing: { after: 300 } }),
      new Paragraph({ text: 'Borrowed Equipment', heading: HeadingLevel.HEADING_2, spacing: { after: 150 } })
    ];

    if (equipmentList.length === 0) {
      children.push(new Paragraph('No equipment currently borrowed.'));
    } else {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                headerCell('Equipment ID', 13),
                headerCell('Item', 13),
                headerCell('Status', 12),
                headerCell('Comment', 15),
                headerCell('Additional Information', 21),
                headerCell('Purpose', 13),
                headerCell('Event', 13)
              ]
            }),
            ...equipmentList.map(
              (eq) =>
                new TableRow({
                  children: [
                    cell(eq.equipmentId, 13),
                    cell(eq.item, 13),
                    cell(eq.status, 12),
                    cell(eq.comment, 15),
                    cell(eq.additionalInfo, 21),
                    cell(eq.purpose, 13),
                    cell(eq.event, 13)
                  ]
                })
            )
          ]
        })
      );
    }

    children.push(
      new Paragraph({
        text: 'Miscellaneous Items',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 150 }
      })
    );

    if (miscList.length === 0) {
      children.push(new Paragraph('No miscellaneous items recorded for this transaction.'));
    } else {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: [headerCell('Item', 50), headerCell('Amount', 50)] }),
            ...miscList.map(
              (m) =>
                new TableRow({
                  children: [cell(m.item, 50), cell(String(m.amount), 50)]
                })
            )
          ]
        })
      );
    }

    const doc = new Document({ sections: [{ children }] });
    const buffer = await Packer.toBuffer(doc);

    // Mark misc items as exported so re-exporting later doesn't repeat them.
    if (miscList.length > 0) {
      await db
        .collection(COLLECTIONS.MISC_LOGS)
        .updateMany({ employeeId, exported: false }, { $set: { exported: true, updatedAt: new Date() } });
    }

    const filename = `Borrow_Record_${employeeId}_${Date.now()}.docx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ message: 'Server error while generating the document.', error: err.message });
  }
});

// GET /api/export/event/:employeeId?event=<event name, or "No Event">
// Builds a .docx listing just the equipment this employee currently has
// reserved or checked out under one specific event - the "Create Equipment
// List" button on each event section of the My Items tab. Uses the exact
// same grouping rule as that tab (utils/status.js's canonicalStatus plus a
// blank/missing event falling under "No Event") so the list always matches
// what's shown on screen. No miscellaneous items section here, since misc
// items aren't tied to any event - that's still covered by the broader
// per-employee Borrow Record export above.
router.get('/event/:employeeId', async (req, res) => {
  try {
    const db = getDb();
    const employeeId = req.params.employeeId.trim();
    const requestedEvent = typeof req.query.event === 'string' ? req.query.event.trim() : '';

    if (!requestedEvent) {
      return res.status(400).json({ message: 'An event name is required.' });
    }

    const employee = await db.collection(COLLECTIONS.EMPLOYEES).findOne({ employeeId });
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found.' });
    }

    const allItems = await db
      .collection(COLLECTIONS.EQUIPMENT)
      .find({ employeeId })
      .sort({ equipmentId: 1 })
      .toArray();

    const equipmentList = allItems.filter((eq) => {
      const status = canonicalStatus(eq.status);
      if (status !== 'Reserved' && status !== 'Unavailable') return false;
      const key = (eq.event && eq.event.trim()) || 'No Event';
      return key === requestedEvent;
    });

    if (equipmentList.length === 0) {
      return res.status(404).json({
        message: `No equipment found for "${employee.name}" under "${requestedEvent}".`
      });
    }

    // Only the item name matters here - equipment ID, status, comment,
    // additional information, and purpose are deliberately left off this
    // document. Several rows sharing the same item name collapse into a
    // single line with a quantity, rather than repeating the name.
    const countByItem = new Map();
    equipmentList.forEach((eq) => {
      const name = (eq.item || '').trim() || 'Unnamed item';
      countByItem.set(name, (countByItem.get(name) || 0) + 1);
    });
    const itemLines = [...countByItem.entries()].sort(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    const children = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [
          new ImageRun({
            data: myruntimeLogoBuffer,
            transformation: { width: MYRUNTIME_LOGO_WIDTH, height: MYRUNTIME_LOGO_HEIGHT }
          })
        ]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 150 },
        children: [
          new TextRun({ text: 'Equipment List', font: 'DM Sans', bold: true, size: 56, color: MYRUNTIME_COLORS.navy })
        ]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [
          new TextRun({ text: 'Employee: ', font: 'Inter', bold: true, size: 22, color: MYRUNTIME_COLORS.teal }),
          new TextRun({ text: `${employee.name} (${employee.employeeId})`, font: 'Inter', size: 22, color: MYRUNTIME_COLORS.teal })
        ]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
        children: [
          new TextRun({ text: 'Event: ', font: 'Inter', bold: true, size: 22, color: MYRUNTIME_COLORS.teal }),
          new TextRun({ text: requestedEvent, font: 'Inter', size: 22, color: MYRUNTIME_COLORS.orange, bold: true })
        ]
      }),
      ...itemLines.map(
        ([name, qty]) =>
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 80 },
            children: [
              new TextRun({ text: name, font: 'Inter', size: 24, color: MYRUNTIME_COLORS.navy }),
              ...(qty > 1
                ? [new TextRun({ text: ` (x${qty})`, font: 'Inter', size: 24, bold: true, color: MYRUNTIME_COLORS.orange })]
                : [])
            ]
          })
      )
    ];

    const doc = new Document({ fonts: myruntimeFonts, sections: [{ children }] });
    const rawBuffer = await Packer.toBuffer(doc);
    const buffer = await embedFontsFlag(rawBuffer);

    const safeEvent = requestedEvent.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Event';
    const filename = `Equipment_List_${employeeId}_${safeEvent}_${Date.now()}.docx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ message: 'Server error while generating the document.', error: err.message });
  }
});

module.exports = router;
