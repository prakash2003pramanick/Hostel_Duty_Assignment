const ExcelJS = require('exceljs');
const moment = require('moment');

const generateDutySheetExcel = async (dutyAssignments, month, year) => {
  const workbook = new ExcelJS.Workbook();

  for (const hostelAssignment of dutyAssignments) {
    const sheet = workbook.addWorksheet(hostelAssignment.hostelName.substring(0, 31));

    // Merge for Hostel Name (Top Title)
    sheet.mergeCells('A1:I1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = `${hostelAssignment.hostelName}`;
    titleCell.font = { bold: true, size: 16 };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // Row 2 Empty
    sheet.addRow([]);

    // Row 3 Header with merged D3 and E3 for "Name"
    const headerRow = sheet.addRow([
      'Date', 'Sl. No.', 'Emp. Code', 'Name', '', 'Designation', 'Department', 'emailId ID', 'Mob. No.'
    ]);
    sheet.mergeCells('D3:E3');

    // Style header
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    for (const duty of hostelAssignment.duties) {
      const dateFormatted = moment(duty.date).format('DD.MM.YYYY');

      // Teaching Faculty Row (Bold)
      const teachingRow = sheet.addRow([
        dateFormatted,
        1,
        duty.teachingFaculty.empCode || '',
        duty.teachingFaculty.title || '',
        duty.teachingFaculty.name || '',
        duty.teachingFaculty.designation || '',
        duty.teachingFaculty.department || '',
        duty.teachingFaculty.emailId || '',
        Array.isArray(duty.teachingFaculty.mobNo)
          ? duty.teachingFaculty.mobNo.join(', ')
          : duty.teachingFaculty.mobNo || ''
      ]);
      teachingRow.font = { bold: true };
      teachingRow.alignment = { vertical: 'middle' };
      teachingRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      // Non-Teaching Faculty Row
      const nonTeachingRow = sheet.addRow([
        '',
        2,
        duty.nonTeachingFaculty.empCode || '',
        duty.nonTeachingFaculty.title || '',
        duty.nonTeachingFaculty.name || '',
        duty.nonTeachingFaculty.designation || '',
        duty.nonTeachingFaculty.department || '',
        duty.nonTeachingFaculty.emailId || '',
        Array.isArray(duty.nonTeachingFaculty.mobNo)
          ? duty.nonTeachingFaculty.mobNo.join(', ')
          : duty.nonTeachingFaculty.mobNo || ''
      ]);
      nonTeachingRow.alignment = { vertical: 'middle' };
      nonTeachingRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });
    }

    // ✅ Auto-adjust column widths based on longest cell in each column
    sheet.columns.forEach((column) => {
      let maxLength = 10;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const cellValue = cell.value ? cell.value.toString() : '';
        maxLength = Math.max(maxLength, cellValue.length);
      });
      column.width = Math.min(maxLength + 2, 40); // Cap width to avoid overly wide columns
    });
  }

  // Return as buffer to be used in response
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};

module.exports = generateDutySheetExcel;
