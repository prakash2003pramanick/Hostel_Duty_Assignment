const Faculty = require('../models/faculty');
const Duty = require('../models/duty');

const moment = require('moment');
const generateDutySheetExcel = require('../utils/convertDutyObjectToExcel');

const assignDuties = async (req, res) => {
    try {
        console.log("Assigning duties...");
        const { hostels, month, year, hostelType } = req.body;
        const gender = (hostelType === "BOY'S") ? "MALE" : "FEMALE";

        const daysInMonth = moment(`${year}-${month}`, "YYYY-MM").daysInMonth();
        const dutyAssignments = [];

        // Fetch all faculties who are not on leave
        const faculties = await Faculty.find({ onLeave: false, gender }).lean();

        // Separate into teaching and non-teaching
        const teachingFaculties = faculties.filter(faculty => faculty.type === 'Teaching');
        const nonTeachingFaculties = faculties.filter(faculty => faculty.type === 'Non-Teaching');

        if (teachingFaculties.length === 0 || nonTeachingFaculties.length === 0) {
            return res.status(400).json({ message: 'Not enough faculty available for assignment' });
        }

        // Sort once initially by lastDuty date
        const sortByLastDuty = (facultyList) => {
            return facultyList.sort((a, b) => {
                const aLastDate = a.lastDuty?.length ? new Date(a.lastDuty[a.lastDuty.length - 1].date) : new Date(0);
                const bLastDate = b.lastDuty?.length ? new Date(b.lastDuty[b.lastDuty.length - 1].date) : new Date(0);
                return aLastDate - bLastDate;
            });
        };

        const teachingQueue = sortByLastDuty(teachingFaculties);
        const nonTeachingQueue = sortByLastDuty(nonTeachingFaculties);

        // Initialize hostel wise structure
        for (const hostel of hostels) {
            dutyAssignments.push({
                hostelName: hostel,
                duties: []
            });
        }

        // Assignment loop
        for (let day = 1; day <= daysInMonth; day++) {
            const date = moment(`${year}-${month}-${day}`, "YYYY-MM-DD").format("YYYY-MM-DD");

            for (const hostelAssignment of dutyAssignments) {

                const teachingFaculty = teachingQueue.shift();
                const nonTeachingFaculty = nonTeachingQueue.shift();

                if (!teachingFaculty || !nonTeachingFaculty) {
                    return res.status(400).json({ message: 'Not enough available faculty for assignment on some days' });
                }

                hostelAssignment.duties.push({
                    date,
                    teachingFaculty,
                    nonTeachingFaculty,
                });

                // Update lastDuty locally
                if (!teachingFaculty.lastDuty) teachingFaculty.lastDuty = [];
                if (!nonTeachingFaculty.lastDuty) nonTeachingFaculty.lastDuty = [];

                teachingFaculty.lastDuty.push({ date, group: hostelAssignment.hostelName });
                nonTeachingFaculty.lastDuty.push({ date, group: hostelAssignment.hostelName });

                // Put back at the end of the queue
                teachingQueue.push(teachingFaculty);
                nonTeachingQueue.push(nonTeachingFaculty);

            }
        }

        // Bulk update database
        const bulkOperations = [];

        [...teachingQueue, ...nonTeachingQueue].forEach(faculty => {
            bulkOperations.push({
                updateOne: {
                    filter: { _id: faculty._id },
                    update: { lastDuty: faculty.lastDuty }
                }
            });
        });

        if (bulkOperations.length > 0) {
            await Faculty.bulkWrite(bulkOperations);
        }

        // // Save duty assignments to the database
        // const dutyData = dutyAssignments.map(assignment => ({
        //     hostelName: assignment.hostelName,
        //     month,
        //     year,
        //     duties: assignment.duties
        // }));
        // const dutyRecords = await Duty.insertMany(dutyData);
        // if (!dutyRecords) {
        //     return res.status(500).json({ message: 'Failed to save duty assignments' });
        // }

        const excelBuffer = await generateDutySheetExcel(dutyAssignments, month, year);

        res.setHeader('Content-Disposition', `attachment; filename="Duty_Sheet_${month}_${year}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        return res.send(excelBuffer);

        res.status(200).json({ message: 'Duties assigned successfully', dutyAssignments });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
};

module.exports = { assignDuties };