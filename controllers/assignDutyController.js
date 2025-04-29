const Faculty = require('../models/faculty');
const moment = require('moment');
const generateDutySheetExcel = require('../utils/convertDutyObjectToExcel');
const Setting = require('../models/settings');

const assignDuties = async (req, res) => {
    try {
        console.log("Assigning duties...");
        const { startDate, endDate, hostelType } = req.body;


        const start = moment(startDate).startOf('day');
        const end = moment(endDate).startOf('day');

        if (!start.isValid() || !end.isValid() || start.isAfter(end)) {
            return res.status(400).json({ message: 'Invalid date range' });
        }

        // get settings 
        const settings = await Setting.findOne();
        let boysHostel = 12, girlsHostel = 5;
        if (settings) {
            boysHostel = settings.boysHostel;
            girlsHostel = settings.girlsHostel;
        }

        const hostels = [];
        let gender = 'FEMALE';
        if (hostelType === "BOY'S") {
            for (let i = 1; i <= boysHostel; i++) {
                hostels.push(`Group ${i}`);
            }
            gender = 'MALE';
        }
        else if (hostelType === "GIRL'S") {
            for (let i = 1; i <= girlsHostel; i++) {
                hostels.push(`Group ${i}`);
            }
        }

        // console.log("Gender", gender);
        // console.log("Hostels", hostels);

        const totalDays = end.diff(start, 'days') + 1;
        const dutyAssignments = [];

        // Fetch eligible faculties
        const faculties = await Faculty.find({ onLeave: false, gender }).lean();
        const teachingFaculties = faculties.filter(f => f.type === 'Teaching');
        const nonTeachingFaculties = faculties.filter(f => f.type === 'Non-Teaching');

        if (teachingFaculties.length === 0 || nonTeachingFaculties.length === 0) {
            return res.status(400).json({ message: 'Not enough faculty available for assignment' });
        }

        const sortByLastDuty = (list) => {
            return list.sort((a, b) => {
                const aDate = a.lastDuty?.length ? new Date(a.lastDuty[a.lastDuty.length - 1].date) : new Date(0);
                const bDate = b.lastDuty?.length ? new Date(b.lastDuty[b.lastDuty.length - 1].date) : new Date(0);
                return aDate - bDate;
            });
        };

        const teachingQueue = sortByLastDuty(teachingFaculties);
        const nonTeachingQueue = sortByLastDuty(nonTeachingFaculties);

        // Initialize duty structure
        for (const hostel of hostels) {
            dutyAssignments.push({
                hostelName: hostel,
                duties: []
            });
        }

        for (let i = 0; i < totalDays; i++) {
            const currentDate = start.clone().add(i, 'days').format('YYYY-MM-DD');

            for (const assignment of dutyAssignments) {
                const teaching = teachingQueue.shift();
                const nonTeaching = nonTeachingQueue.shift();

                if (!teaching || !nonTeaching) {
                    return res.status(400).json({ message: 'Not enough available faculty for assignment on some days' });
                }

                assignment.duties.push({
                    date: currentDate,
                    teachingFaculty: teaching,
                    nonTeachingFaculty: nonTeaching,
                });

                teaching.lastDuty = teaching.lastDuty || [];
                nonTeaching.lastDuty = nonTeaching.lastDuty || [];

                teaching.lastDuty.push({ date: currentDate, group: assignment.hostelName });
                nonTeaching.lastDuty.push({ date: currentDate, group: assignment.hostelName });

                teachingQueue.push(teaching);
                nonTeachingQueue.push(nonTeaching);
            }
        }

        // Bulk update lastDuty
        const bulkOperations = [...teachingQueue, ...nonTeachingQueue].map(faculty => ({
            updateOne: {
                filter: { _id: faculty._id },
                update: { lastDuty: faculty.lastDuty }
            }
        }));

        if (bulkOperations.length > 0) {
            await Faculty.bulkWrite(bulkOperations);
        }

        // Generate Excel
        const fileLabel = `${start.format('YYYYMMDD')}_to_${end.format('YYYYMMDD')}`;
        const excelBuffer = await generateDutySheetExcel(dutyAssignments, start.format('MM'), start.format('YYYY'));

        res.setHeader('Content-Disposition', `attachment; filename="Duty_Sheet_${fileLabel}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        return res.send(excelBuffer);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
};

module.exports = { assignDuties };
