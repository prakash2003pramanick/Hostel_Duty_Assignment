const Faculty = require('../models/faculty');
const moment = require('moment');
const generateDutySheetExcel = require('../utils/convertDutyObjectToExcel');
const Setting = require('../models/settings');
const archiver = require('archiver');
const stream = require('stream');

const assignDuties = async (req, res) => {
    try {
        console.log("Assigning duty");
        const { startDate, endDate, hostelType } = req.body;
        const start = moment(startDate, 'YYYY-MM-DD').startOf('day');
        const end = moment(endDate, 'YYYY-MM-DD').startOf('day');

        if (!start.isValid() || !end.isValid() || start.isAfter(end)) {
            return res.status(400).json({ message: 'Invalid date range' });
        }

        const settings = await Setting.findOne();
        const boysHostel = settings?.boysHostel || 12;
        const girlsHostel = settings?.girlsHostel || 5;

        const hostels = [];
        let gender = 'FEMALE';
        if (hostelType === "BOY'S") {
            for (let i = 1; i <= boysHostel; i++) hostels.push(`Group ${i}`);
            gender = 'MALE';
        } else {
            for (let i = 1; i <= girlsHostel; i++) hostels.push(`Group ${i}`);
        }
        console.log(`Hostels: ${hostels.join(', ')}`);

        const totalDays = end.diff(start, 'days') + 1;
        const faculties = await Faculty.find({
            gender: { $regex: `^${gender}$`, $options: 'i' }  // case-insensitive match
        }).lean();
        const teachingFaculties = faculties.filter(f => f.type === 'Teaching');
        const nonTeachingFaculties = faculties.filter(f => f.type === 'Non-Teaching');

        console.log(`Total faculties found: ${faculties.length}`);
        console.log(`Teaching faculties: ${teachingFaculties.length}, Non-Teaching faculties: ${nonTeachingFaculties.length}`);

        if (teachingFaculties.length === 0 || nonTeachingFaculties.length === 0) {
            return res.status(400).json({ message: 'Not enough faculty available for assignment' });
        }

        const sortByLastDuty = (list) => list.sort((a, b) => {
            const aDate = a.lastDuty?.length ? new Date(a.lastDuty[a.lastDuty.length - 1].date) : new Date(0);
            const bDate = b.lastDuty?.length ? new Date(b.lastDuty[b.lastDuty.length - 1].date) : new Date(0);
            return aDate - bDate;
        });
        console.log(`Sorting faculties by last duty date...`);

        const teachingQueue = sortByLastDuty(teachingFaculties);
        const nonTeachingQueue = sortByLastDuty(nonTeachingFaculties);
        console.log(`Total Teaching Faculty: ${teachingQueue.length}, Total Non-Teaching Faculty: ${nonTeachingQueue.length}`);

        const dutyMap = {}; // { 'YYYY-MM': [assignments] }

        for (const hostel of hostels) {
            for (let i = 0; i < totalDays; i++) {
                const currentDate = start.clone().add(i, 'days').format('YYYY-MM-DD');
                const key = moment(currentDate).format('YYYY-MM');

                if (!dutyMap[key]) dutyMap[key] = [];

                let assignment = dutyMap[key].find(d => d.hostelName === hostel);
                if (!assignment) {
                    assignment = { hostelName: hostel, duties: [] };
                    dutyMap[key].push(assignment);
                }

                const teaching = teachingQueue.shift();
                const nonTeaching = nonTeachingQueue.shift();

                if (!teaching || !nonTeaching) {
                    return res.status(400).json({ message: 'Not enough faculty for some days' });
                }

                assignment.duties.push({
                    date: currentDate,
                    teachingFaculty: teaching,
                    nonTeachingFaculty: nonTeaching
                });

                teaching.lastDuty = teaching.lastDuty || [];
                nonTeaching.lastDuty = nonTeaching.lastDuty || [];

                teaching.lastDuty.push({ date: currentDate, group: hostel });
                nonTeaching.lastDuty.push({ date: currentDate, group: hostel });

                teachingQueue.push(teaching);
                nonTeachingQueue.push(nonTeaching);
            }
        }
        console.log(`Duty assignments created for ${Object.keys(dutyMap).length} months`);

        const bulkOperations = [...teachingQueue, ...nonTeachingQueue].map(f => ({
            updateOne: {
                filter: { _id: f._id },
                update: { lastDuty: f.lastDuty }
            }
        }));
        if (bulkOperations.length > 0) await Faculty.bulkWrite(bulkOperations);

        const monthKeys = Object.keys(dutyMap);
        console.log(`Duty assignments created for ${monthKeys.length} months`);
        if (monthKeys.length === 1) {
            const [monthYear] = monthKeys;
            const [year, month] = monthYear.split('-');
            const buffer = await generateDutySheetExcel(dutyMap[monthYear], month, year);
            const label = `${start.format('YYYYMMDD')}_to_${end.format('YYYYMMDD')}`;
            res.setHeader('Content-Disposition', `attachment; filename="Duty_Sheet_${label}.xlsx"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            return res.send(buffer);
        } else {
            const archive = archiver('zip', { zlib: { level: 9 } });
            const passthrough = new stream.PassThrough();

            res.setHeader('Content-Disposition', `attachment; filename="Duty_Sheets_${start.format('YYYYMMDD')}_to_${end.format('YYYYMMDD')}.zip"`);
            res.setHeader('Content-Type', 'application/zip');
            passthrough.pipe(res);

            archive.pipe(passthrough);

            for (const [monthYear, assignments] of Object.entries(dutyMap)) {
                const [year, month] = monthYear.split('-');
                const buffer = await generateDutySheetExcel(assignments, month, year);
                archive.append(buffer, { name: `Duty_Sheet_${monthYear}.xlsx` });
            }

            archive.finalize();
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
};

module.exports = { assignDuties };
