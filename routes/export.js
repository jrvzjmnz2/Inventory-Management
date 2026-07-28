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
  ShadingType
} = require('docx');
const { getDb } = require('../db');
const { COLLECTIONS } = require('../constants');

const router = express.Router();

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

module.exports = router;
