const Faculty = require('../models/faculty');
const XLSX = require('xlsx');
const moment = require('moment');

const generateFacultyDutyFrequency = async (req, res) => {
    try {
        const { year } = req.body;

        if (!year) {
            return res.status(400).json({ message: 'Year is required' });
        }

        const faculties = await Faculty.find({}).lean();

        // Prepare data rows
        const data = [];

        // Header row
        const header = [
            'Faculty Name',
            'Faculty ID',
            'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ];
        data.push(header);

        // Each faculty
        faculties.forEach(faculty => {
            const monthlyCount = Array(12).fill(0);

            if (faculty.lastDuty && faculty.lastDuty.length) {
                faculty.lastDuty.forEach(duty => {
                    const dutyDate = new Date(duty.date);
                    if (dutyDate.getFullYear() === parseInt(year)) {
                        const monthIndex = dutyDate.getMonth(); // 0 = January
                        monthlyCount[monthIndex]++;
                    }
                });
            }

            const row = [
                faculty.name,
                faculty._id.toString(),
                ...monthlyCount
            ];

            data.push(row);
        });

        // Create workbook and worksheet
        const worksheet = XLSX.utils.aoa_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'FacultyDutyReport');

        // Write to buffer
        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

        // Send file to client
        res.setHeader('Content-Disposition', `attachment; filename=Faculty_Duty_Report_${year}.xlsx`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(excelBuffer);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
};

const generateFacultyDutyReport = async (req, res) => {
    try {
        const { empCode } = req.params;
        

        if (!empCode) {
            return res.status(400).json({ message: 'Employee code is required' });
        }

        const faculty = await Faculty.findOne({ empCode }).lean();
        if (!faculty) {
            return res.status(404).json({ message: 'Faculty not found' });
        }
        return res.status(200).json({ message: 'Faculty found', faculty });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}
module.exports = { generateFacultyDutyFrequency, generateFacultyDutyReport };
