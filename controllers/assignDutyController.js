// (top of the file remains unchanged)
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path'); // needed for file paths
const Faculty = require('../models/faculty');
const Hostel = require('../models/hostel');
const DutyAssignment = require('../models/dutyAssignment');
const e = require('express');

const getLastDutyDate = (faculty) => {
    // If lastDuty doesn't exist or doesn't have a date property, return epoch time
    if (!faculty.lastDuty || !faculty.lastDuty.date) {
        return new Date(0);
    }
    const dutyDate = new Date(faculty.lastDuty.date);
    // Ensure the date is valid; otherwise, return epoch
    return isNaN(dutyDate.getTime()) ? new Date(0) : dutyDate;
};

// Sorts faculty lists by the last duty date, ascending (least recent first)
const sortFacultyByLastDuty = (facultyList) => {
    return facultyList.sort((a, b) => getLastDutyDate(a) - getLastDutyDate(b));
};

const assignDuties = async (req, res) => {
    try {
        const { startDate, endDate, gender, excludeHostels, overwrite = false } = req.body;

        if (!startDate || !endDate || !gender) {
            return res.status(400).json({ message: "Missing required fields: startDate, endDate, gender" });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ message: "Invalid startDate or endDate provided." });
        }

        const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
        const workbook = xlsx.utils.book_new();
        const EXCLUDED_SCHOOLS = ['SCHOOL OF COMPUTER ENGINEERING', 'SCHOOL OF COMPUTER APPLICATIONS', 'SCHOOL OF COMPUTER SCIENCE'];
        const genderRegex = gender.toUpperCase() === 'MALE' ? /^BOYS$/i : /^GIRLS$/i;

        const hostels = await Hostel.aggregate([
            { $match: { type: { $regex: genderRegex }, name: { $nin: excludeHostels || [] } } },
            {
                $addFields: {
                    associatedSchoolCount: { $size: "$associatedSchools" },
                    isAllEngineering: { $in: ["ALL ENGINEERING SCHOOL", "$associatedSchools"] },
                    isExcluded: { $gt: [{ $size: { $setIntersection: ["$associatedSchools", EXCLUDED_SCHOOLS] } }, 0] },
                    isPreferredSchool: {
                        $cond: [
                            { $eq: ["$associatedSchools", []] }, false,
                            { $allElementsTrue: { $map: { input: "$associatedSchools", as: "school", in: { $regexMatch: { input: "$$school", regex: /^SCHOOL OF/ } } } } }
                        ]
                    }
                }
            },
            { $sort: { isAllEngineering: 1, isExcluded: 1, isPreferredSchool: -1, associatedSchoolCount: 1 } }
        ]);

        if (hostels.length === 0) {
            return res.status(404).json({ message: "No hostels found for the specified gender and exclusions." });
        }

        const allEligibleFaculty = await Faculty.find({
            gender: new RegExp(`^${gender}$`, 'i'),
            orgUnit: { $nin: EXCLUDED_SCHOOLS }
        });

        const facultyById = new Map(allEligibleFaculty.map(f => [f._id.toString(), f]));
        const hostelNames = hostels.map(h => h.name);

        const existingAssignmentsMap = new Map();
        let hostelMonthlyCompletion = new Map();

        if (!overwrite) {
            const existingAssignments = await DutyAssignment.find({
                date: { $gte: start, $lte: end },
                hostel: { $in: hostelNames }
            }).lean();

            const monthlyRoomStats = new Map(); // key: hostel:YYYY-MM → maxRoomAssigned
            for (const assignment of existingAssignments) {
                const dateStr = new Date(assignment.date).toISOString().split('T')[0];
                const monthKey = `${assignment.hostel}:${dateStr.slice(0, 7)}`;
                const [startR, endR] = assignment.roomRange.split('-').map(n => parseInt(n.trim()));
                const max = Math.max(startR, endR);
                const prev = monthlyRoomStats.get(monthKey) || 0;
                monthlyRoomStats.set(monthKey, Math.max(prev, max));

                const key = `${dateStr}:${assignment.hostel}`;
                existingAssignmentsMap.set(key, assignment);
            }

            for (const [key, maxRoom] of monthlyRoomStats.entries()) {
                const [hostelName] = key.split(':');
                const hostelObj = hostels.find(h => h.name === hostelName);
                if (hostelObj && maxRoom >= hostelObj.numberOfRooms) {
                    hostelMonthlyCompletion.set(key, true);
                }
            }
        }

        const latestAssignments = await DutyAssignment.aggregate([
            { $match: { hostel: { $in: hostelNames } } },
            { $sort: { date: -1 } },
            { $group: { _id: "$hostel", roomRange: { $first: "$roomRange" } } }
        ]);

        const roomRangeByHostelName = new Map();
        latestAssignments.forEach(a => roomRangeByHostelName.set(a._id, a.roomRange));

        const hostelRoomPointers = new Map(
            hostels.map(h => {
                const roomRange = roomRangeByHostelName.get(h.name);
                let lastEnd = 0;
                if (roomRange) {
                    const rangeParts = roomRange.split('-').map(p => parseInt(p.trim()));
                    lastEnd = rangeParts.length > 1 ? rangeParts[1] : rangeParts[0];
                }
                return [h._id.toString(), lastEnd];
            })
        );

        const facultyBySchool = new Map();
        for (const f of allEligibleFaculty) {
            const school = f.orgUnit?.toUpperCase();
            const group = f.employeeGroup === 'Teaching' ? 'teaching' : 'nonTeaching';
            if (!school || EXCLUDED_SCHOOLS.includes(school)) continue;
            if (!facultyBySchool.has(school)) {
                facultyBySchool.set(school, { teaching: [], nonTeaching: [] });
            }
            facultyBySchool.get(school)[group].push(f);
        }

        facultyBySchool.forEach(schoolGroups => {
            sortFacultyByLastDuty(schoolGroups.teaching);
            sortFacultyByLastDuty(schoolGroups.nonTeaching);
        });

        const getAvailableFaculty = (associatedSchools, date, type) => {
            const targetDate = new Date(date);
            const targetMonth = targetDate.getMonth();
            const targetYear = targetDate.getFullYear();

            let best = null, bestSchool = null, bestDate = new Date(8640000000000000);
            for (const school of associatedSchools) {
                const upper = school.toUpperCase();
                const list = facultyBySchool.get(upper)?.[type];
                if (list?.length) {
                    const cand = list[0];
                    const last = getLastDutyDate(cand);
                    if ((last.getMonth() !== targetMonth || last.getFullYear() !== targetYear) && last < bestDate) {
                        best = cand;
                        bestSchool = upper;
                        bestDate = last;
                    }
                }
            }
            if (best) {
                const list = facultyBySchool.get(bestSchool)[type];
                list.shift(); list.push(best);
                return best;
            }

            // Fallback
            let oldest = null, oldestSchool = null, oldestDate = new Date(8640000000000000);
            for (const [school, group] of facultyBySchool.entries()) {
                const list = group[type];
                if (list?.length) {
                    const cand = list[0];
                    const last = getLastDutyDate(cand);
                    if (last < oldestDate) {
                        oldest = cand;
                        oldestSchool = school;
                        oldestDate = last;
                    }
                }
            }
            if (oldest) {
                const list = facultyBySchool.get(oldestSchool)[type];
                list.shift(); list.push(oldest);
                return oldest;
            }
            return null;
        };

        const newAssignments = [];
        const facultyUpdates = [];
        const workbookData = {};

        for (const hostel of hostels) {
            const hostelId = hostel._id.toString();
            const associatedSchools = Array.isArray(hostel.associatedSchools) ? hostel.associatedSchools.map(s => s.toUpperCase()) : [];
            workbookData[hostel.name] = [
                ["Date", "Hostel", "Room Range", "Faculty Type", "Faculty Name", "Faculty ID", "Designation", "Org Unit", "Employee Group", "Gender", "Official Email", "Personal Email", "Mobile"]
            ];

            let hostelDutiesFinished = false;
            const ROOMS_PER_DAY = 20;

            for (let offset = 0; offset < totalDays; offset++) {
                if (hostelDutiesFinished) break;
                const date = new Date(start);
                date.setDate(start.getDate() + offset);
                const dateStr = date.toISOString().split('T')[0];
                const monthKey = `${hostel.name}:${dateStr.slice(0, 7)}`;
                const lookupKey = `${dateStr}:${hostel.name}`;

                if (!overwrite && hostelMonthlyCompletion.get(monthKey)) {
                    console.log(`Skipping ${hostel.name} for ${monthKey} as duty is already completed.`);
                    continue;
                }

                const existingAssignment = existingAssignmentsMap.get(lookupKey);
                if (existingAssignment) {
                    const f1 = facultyById.get(existingAssignment.faculty1.id.toString());
                    const f2 = facultyById.get(existingAssignment.faculty2.id.toString());
                    if (!f1 || !f2) continue;

                    const teaching = f1.employeeGroup === 'Teaching' ? f1 : f2;
                    const nonTeaching = f1.employeeGroup === 'Teaching' ? f2 : f1;

                    workbookData[hostel.name].push([
                        dateStr, hostel.name, existingAssignment.roomRange, "Teaching", teaching.name, teaching.employeeCode, teaching.designation, teaching.orgUnit, teaching.employeeGroup, teaching.gender, teaching.officialEmail, teaching.personalEmail, teaching.mobile
                    ]);
                    workbookData[hostel.name].push([
                        "", "", "", "Non-Teaching", nonTeaching.name, nonTeaching.employeeCode, nonTeaching.designation, nonTeaching.orgUnit, nonTeaching.employeeGroup, nonTeaching.gender, nonTeaching.officialEmail, nonTeaching.personalEmail, nonTeaching.mobile
                    ]);
                    workbookData[hostel.name].push([]);
                    continue;
                }

                let currentRoomStart = (hostelRoomPointers.get(hostelId) % hostel.numberOfRooms) + 1;
                if (currentRoomStart > hostel.numberOfRooms) {
                    hostelDutiesFinished = true;
                    continue;
                }

                let endRoom = currentRoomStart + ROOMS_PER_DAY - 1;
                if (endRoom >= hostel.numberOfRooms) {
                    endRoom = hostel.numberOfRooms;
                    hostelDutiesFinished = true;
                }

                const roomRange = `${currentRoomStart}-${endRoom}`;
                hostelRoomPointers.set(hostelId, endRoom);

                const tFaculty = getAvailableFaculty(associatedSchools, date, 'teaching');
                const ntFaculty = getAvailableFaculty(associatedSchools, date, 'nonTeaching');
                if (!tFaculty || !ntFaculty) continue;
                const dutyInfo = { date, hostel: hostel.name, roomAlloted: roomRange, numberOfRooms: endRoom - currentRoomStart + 1 };
                tFaculty.lastDuty = dutyInfo;
                ntFaculty.lastDuty = dutyInfo;

                newAssignments.push({
                    school: tFaculty.orgUnit, date, hostel: hostel.name, roomRange,
                    faculty1: { id: tFaculty._id, name: tFaculty.name, employeeGroup: 'Teaching' },
                    faculty2: { id: ntFaculty._id, name: ntFaculty.name, employeeGroup: 'Non-Teaching' }
                });

                facultyUpdates.push({ updateOne: { filter: { _id: tFaculty._id }, update: { $set: { lastDuty: dutyInfo } } } });
                facultyUpdates.push({ updateOne: { filter: { _id: ntFaculty._id }, update: { $set: { lastDuty: dutyInfo } } } });

                workbookData[hostel.name].push([
                    dateStr, hostel.name, roomRange, "Teaching", tFaculty.name, tFaculty.employeeCode, tFaculty.designation, tFaculty.orgUnit, tFaculty.employeeGroup, tFaculty.gender, tFaculty.officialEmail, tFaculty.personalEmail, tFaculty.mobile
                ]);
                workbookData[hostel.name].push([
                    "", "", "", "Non-Teaching", ntFaculty.name, ntFaculty.employeeCode, ntFaculty.designation, ntFaculty.orgUnit, ntFaculty.employeeGroup, ntFaculty.gender, ntFaculty.officialEmail, ntFaculty.personalEmail, ntFaculty.mobile
                ]);
                workbookData[hostel.name].push([]);
            }
        }

        if (newAssignments.length > 0) await DutyAssignment.insertMany(newAssignments);
        if (facultyUpdates.length > 0) await Faculty.bulkWrite(facultyUpdates);

        for (const hostelName in workbookData) {
            if (workbookData[hostelName].length > 1) {
                let sheetName = hostelName.replace(/[/\\?*[\]]/g, '').slice(0, 31);
                const sheet = xlsx.utils.aoa_to_sheet(workbookData[hostelName]);
                xlsx.utils.book_append_sheet(workbook, sheet, sheetName);
            }
        }

        const filePath = path.join(__dirname, `../duty-output-${Date.now()}.xlsx`);
        xlsx.writeFile(workbook, filePath);

        res.download(filePath, 'duty-schedule.xlsx', (err) => {
            if (err) console.error('Download error:', err);
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting temp file:', unlinkErr);
            });
        });

    } catch (error) {
        console.error("Error in assignDuties:", error);
        res.status(500).json({ message: "An internal server error occurred during duty assignment." });
    }
};

const assignDutiesManually = async (req, res) => {
    try {
        let assignments = req.body;

        // Allow single object as well as array
        if (!assignments || (typeof assignments !== 'object')) {
            return res.status(400).json({ error: "Invalid input format. Expecting an object or array of assignments." });
        }

        if (!Array.isArray(assignments)) {
            assignments = [assignments];
        }

        if (assignments.length === 0) {
            return res.status(400).json({ error: "No assignments provided." });
        }

        const bulkDutyOps = [];
        const bulkFacultyOps = [];

        for (let i = 0; i < assignments.length; i++) {
            const entry = assignments[i];
            const { faculty1Id, faculty2Id, hostelName, date, range } = entry;

            // Validate required fields
            if (!faculty1Id || !faculty2Id || !hostelName || !date || !range) {
                return res.status(400).json({
                    error: `Missing required fields in assignment at index ${i}. Required: faculty1Id, faculty2Id, hostelName, date, range.`
                });
            }

            // Validate date
            const dutyDate = new Date(date);
            if (isNaN(dutyDate)) {
                return res.status(400).json({
                    error: `Invalid date provided in assignment at index ${i}: ${date}`
                });
            }

            // Fetch faculty details
            const [faculty1, faculty2] = await Promise.all([
                Faculty.findOne({ employeeCode: faculty1Id }),
                Faculty.findOne({ employeeCode: faculty2Id })
            ]);

            if (!faculty1 || !faculty2) {
                return res.status(400).json({
                    error: `Invalid faculty ID(s) in assignment at index ${i}.`
                });
            }

            // Create duty assignment
            bulkDutyOps.push({
                insertOne: {
                    document: {
                        school: faculty1.orgUnit || "UNKNOWN",
                        date: dutyDate,
                        hostel: hostelName,
                        roomRange: range,
                        faculty1: {
                            id: faculty1._id,
                            name: faculty1.name,
                            employeeGroup: faculty1.employeeGroup,
                        },
                        faculty2: {
                            id: faculty2._id,
                            name: faculty2.name,
                            employeeGroup: faculty2.employeeGroup,
                        },
                    },
                },
            });

            // Update lastDuty if newer
            const updateLastDuty = (faculty) => {
                return !faculty.lastDuty?.date || new Date(faculty.lastDuty.date) < dutyDate;
            };

            if (updateLastDuty(faculty1)) {
                bulkFacultyOps.push({
                    updateOne: {
                        filter: { _id: faculty1._id },
                        update: {
                            $set: {
                                lastDuty: {
                                    date: dutyDate,
                                    hostel: hostelName,
                                    roomAlloted: range,
                                    numberOfRooms: calculateRoomCount(range),
                                },
                            },
                        },
                    },
                });
            }

            if (updateLastDuty(faculty2)) {
                bulkFacultyOps.push({
                    updateOne: {
                        filter: { _id: faculty2._id },
                        update: {
                            $set: {
                                lastDuty: {
                                    date: dutyDate,
                                    hostel: hostelName,
                                    roomAlloted: range,
                                    numberOfRooms: calculateRoomCount(range),
                                },
                            },
                        },
                    },
                });
            }
        }

        if (bulkDutyOps.length > 0) {
            await DutyAssignment.bulkWrite(bulkDutyOps);
        }

        if (bulkFacultyOps.length > 0) {
            await Faculty.bulkWrite(bulkFacultyOps);
        }

        return res.status(200).json({ message: "Duties assigned successfully ✅" });

    } catch (err) {
        console.error("Duty assignment error:", err);
        return res.status(500).json({ error: "Something went wrong during duty assignment." });
    }
};

// Util: parse "1-20" → 20 rooms
function calculateRoomCount(range) {
    const [start, end] = range.split("-").map(Number);
    if (!isNaN(start) && !isNaN(end)) return end - start + 1;
    return 0;
}

module.exports = { assignDuties, assignDutiesManually };