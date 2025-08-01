const DutyAssignment = require('../models/dutyAssignment');
const hostel = require('../models/hostel');
const xlsx = require("xlsx");
const Faculty = require('../models/faculty');
const path = require('path');
const fs = require('fs');

const assignDuties = async (req, res) => {
    console.log("Assigning duties with body:", req.body);
    if (!req.body.schoolNames || !req.body.startDate || !req.body.endDate) {
        return res.status(400).json({ message: "Missing required fields: schoolNames, startDate, endDate" });
    }

    const { schoolNames, startDate, endDate, gender } = req.body;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    const workbook = xlsx.utils.book_new();

    for (const school of schoolNames) {
        const schoolName = school.toUpperCase().trim();
        const hostels = await hostel.find({
            'associatedSchools.school': schoolName,
            type: {
                $regex: gender.toUpperCase() === 'MALE'
                    ? new RegExp('^BOYS$', 'i')
                    : new RegExp('^GIRLS$', 'i')
            }
        });
        console.log(`Processing school: ${schoolName}, Hostels found: ${hostels.length}`);
        if (!hostels || hostels.length === 0) continue;

        const facultyList = await Faculty.find({
            orgUnit: school,
            gender: { $regex: new RegExp(`^${gender}$`, 'i') }
        });
        const teaching = facultyList.filter(f => f.employeeGroup === 'Teaching');
        const nonTeaching = facultyList.filter(f => f.employeeGroup !== 'Teaching');

        if (!teaching.length || !nonTeaching.length) continue;

        const existingDuties = await DutyAssignment.find({
            school,
            date: { $gte: start, $lte: end }
        });

        const dutyMap = new Map(); // key: date_hostel, value: duty entry
        existingDuties.forEach(d => {
            dutyMap.set(`${d.date.toDateString()}_${d.hostel}`, d);
        });

        const sortByLastDuty = list => list.sort((a, b) => {
            const dateA = a.lastDuty?.slice(-1)[0]?.date || new Date(0);
            const dateB = b.lastDuty?.slice(-1)[0]?.date || new Date(0);
            return dateA - dateB;
        });

        let teachingIndex = 0;
        let nonTeachingIndex = 0;
        const rows = [];

        // Add header row
        rows.push([
            "Date", "Hostel", "Room Range", "Faculty Type",
            "Faculty Name", "Faculty ID", "Designation", "Org Unit",
            "Employee Group", "Gender", "Official Email", "Personal Email", "Mobile"
        ]);

        for (let offset = 0; offset < totalDays; offset++) {
            const date = new Date(start);
            date.setDate(start.getDate() + offset);

            for (const h of hostels) {
                const key = `${date.toDateString()}_${h.name}`;
                let duty = dutyMap.get(key);

                let faculty1, faculty2, startRoom, endRoom;

                if (!duty) {
                    const roomsPerDay = Math.ceil(h.numberOfRooms / totalDays);
                    startRoom = offset * roomsPerDay + 1;
                    endRoom = Math.min(startRoom + roomsPerDay - 1, h.numberOfRooms);

                    const sortedTeaching = sortByLastDuty(teaching);
                    const sortedNonTeaching = sortByLastDuty(nonTeaching);

                    faculty1 = sortedTeaching[teachingIndex % sortedTeaching.length];
                    faculty2 = sortedNonTeaching[nonTeachingIndex % sortedNonTeaching.length];
                    teachingIndex++;
                    nonTeachingIndex++;

                    // Update lastDuty
                    faculty1.lastDuty.push({ date, hostel: h.name, roomAlloted: `${startRoom}-${endRoom}`, numberOfRooms: roomsPerDay });
                    faculty2.lastDuty.push({ date, hostel: h.name, roomAlloted: `${startRoom}-${endRoom}`, numberOfRooms: roomsPerDay });
                    await Promise.all([faculty1.save(), faculty2.save()]);

                    // Save to DB
                    duty = await DutyAssignment.create({
                        school,
                        date,
                        hostel: h.name,
                        roomRange: `${startRoom}-${endRoom}`,
                        faculty1: { id: faculty1._id, name: faculty1.name, employeeGroup: faculty1.employeeGroup },
                        faculty2: { id: faculty2._id, name: faculty2.name, employeeGroup: faculty2.employeeGroup }
                    });
                } else {
                    faculty1 = await Faculty.findById(duty.faculty1.id);
                    faculty2 = await Faculty.findById(duty.faculty2.id);
                    [startRoom, endRoom] = duty.roomRange.split('-');
                }

                // Teaching Row
                rows.push([
                    date.toDateString(),
                    h.name,
                    `${startRoom}-${endRoom}`,
                    "Teaching",
                    faculty1.name,
                    faculty1.employeeCode,
                    faculty1.designation,
                    faculty1.orgUnit,
                    faculty1.employeeGroup,
                    faculty1.gender,
                    faculty1.officialEmail,
                    faculty1.personalEmail,
                    faculty1.mobile
                ]);

                // Non-Teaching Row
                rows.push([
                    "", "", "", "Non-Teaching",
                    faculty2.name,
                    faculty2.employeeCode,
                    faculty2.designation,
                    faculty2.orgUnit,
                    faculty2.employeeGroup,
                    faculty2.gender,
                    faculty2.officialEmail,
                    faculty2.personalEmail,
                    faculty2.mobile
                ]);

                // Empty row after each hostel block
                rows.push([]);
            }
        }

        const sheet = xlsx.utils.aoa_to_sheet(rows);
        xlsx.utils.book_append_sheet(workbook, sheet, school);
    }

    const filePath = path.join(__dirname, '../duty-output.xlsx');
    xlsx.writeFile(workbook, filePath);

    res.download(filePath, 'duty-schedule.xlsx', err => {
        if (err) console.error('Download error:', err);
        fs.unlinkSync(filePath);
    });
};

module.exports = { assignDuties };
