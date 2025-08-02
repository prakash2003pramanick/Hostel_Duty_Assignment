// (top of the file remains unchanged)
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path'); // needed for file paths
const Faculty = require('../models/faculty');
const Hostel = require('../models/hostel');
const DutyAssignment = require('../models/dutyAssignment');
const e = require('express');

// --- Helper Functions ---

// A more robust helper to get the last duty date
// MODIFIED: Now expects faculty.lastDuty to be an object, not an array.
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
// No change needed here, as it relies on the updated getLastDutyDate
const sortFacultyByLastDuty = (facultyList) => {
    return facultyList.sort((a, b) => getLastDutyDate(a) - getLastDutyDate(b));
};

const assignDuties = async (req, res) => {
    try {
        const { startDate, endDate, gender, excludeHostels } = req.body;

        if (!startDate || !endDate || !gender) {
            return res.status(400).json({ message: "Missing required fields: startDate, endDate, gender" });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
        const workbook = xlsx.utils.book_new();

        const EXCLUDED_SCHOOLS = ['SCHOOL OF COMPUTER ENGINEERING', 'SCHOOL OF COMPUTER APPLICATIONS', 'SCHOOL OF COMPUTER SCIENCE'];

        // =================================================================
        // 1. PRE-FETCH AND PREPARE ALL DATA (MAJOR OPTIMIZATION)
        // =================================================================

        // Fetch all hostels and eligible faculty ONCE
        const genderRegex = gender.toUpperCase() === 'MALE' ? /^BOYS$/i : /^GIRLS$/i;

        const hostels = await Hostel.aggregate([
            {
                $match: {
                    type: { $regex: genderRegex },
                    name: { $nin: excludeHostels }
                }
            },
            {
                $addFields: {
                    associatedSchoolCount: { $size: "$associatedSchools" },
                    isAllEngineering: {
                        $in: ["ALL ENGINEERING SCHOOL", "$associatedSchools"]
                    },
                    isExcluded: {
                        $gt: [
                            { $size: { $setIntersection: ["$associatedSchools", EXCLUDED_SCHOOLS] } },
                            0
                        ]
                    },
                    isPreferredSchool: {
                        $cond: [
                            { $eq: ["$associatedSchools", []] },
                            false,
                            {
                                $allElementsTrue: {
                                    $map: {
                                        input: "$associatedSchools",
                                        as: "school",
                                        in: { $regexMatch: { input: "$$school", regex: /^SCHOOL OF/ } }
                                    }
                                }
                            }
                        ]
                    }
                }
            },
            {
                $sort: {
                    isAllEngineering: 1,     // false first
                    isExcluded: 1,           // false next
                    isPreferredSchool: -1,   // true first
                    associatedSchoolCount: 1
                }
            }
        ]);


        if (hostels.length === 0) {
            return res.status(404).json({ message: "No hostels found for the specified gender." });
        }

        const allEligibleFaculty = await Faculty.find({
            gender: new RegExp(`^${gender}$`, 'i'),
            orgUnit: { $nin: EXCLUDED_SCHOOLS }
        });

        // Fetch last assignments for all hostels ONCE to determine starting points
        const hostelNames = hostels.map(h => h.name);
        const latestAssignments = await DutyAssignment.aggregate([
            { $match: { hostel: { $in: hostelNames } } },
            { $sort: { date: -1 } },
            {
                $group: {
                    _id: "$hostel",
                    roomRange: { $first: "$roomRange" }
                }
            }
        ]);

        // Map hostel name to roomRange (e.g., "21-40")
        const roomRangeByHostelName = new Map();
        latestAssignments.forEach(a => {
            roomRangeByHostelName.set(a._id, a.roomRange);
        });

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

        // Organize faculty by school for efficient lookups
        const facultyBySchool = new Map();

        for (const f of allEligibleFaculty) {
            const school = f.orgUnit?.toUpperCase();
            const group = f.employeeGroup === 'Teaching' ? 'teaching' : 'nonTeaching';

            // Skip excluded schools
            if (!school || EXCLUDED_SCHOOLS.includes(school)) continue;

            if (!facultyBySchool.has(school)) {
                facultyBySchool.set(school, { teaching: [], nonTeaching: [] });
            }
            facultyBySchool.get(school)[group].push(f);
        }

        // Sort all faculty lists ONCE
        facultyBySchool.forEach(schoolGroups => {
            sortFacultyByLastDuty(schoolGroups.teaching);
            sortFacultyByLastDuty(schoolGroups.nonTeaching);
        });

        getAvailableFaculty = (associatedSchools, date, hostel, roomRange, currentRoomStart, endRoom, type) => {
            const targetDate = new Date(date);
            const targetMonth = targetDate.getMonth();
            const targetYear = targetDate.getFullYear();

            // 1. Try faculty from associated schools — pick the one with oldest lastDuty
            let bestFaculty = null;
            let bestSchool = null;
            let bestLastDutyDate = null;

            for (const school of associatedSchools) {
                const schoolUpper = school.toUpperCase();
                if (facultyBySchool.has(schoolUpper)) {
                    const facultyList = facultyBySchool.get(schoolUpper)[type];
                    if (facultyList.length > 0) {
                        const faculty = facultyList[0];
                        const lastDutyDate = new Date(faculty.lastDuty?.date);
                        const isEligible =
                            isNaN(lastDutyDate) || // never assigned
                            lastDutyDate.getMonth() !== targetMonth ||
                            lastDutyDate.getFullYear() !== targetYear;

                        if (isEligible) {
                            const effectiveDate = isNaN(lastDutyDate) ? new Date(0) : lastDutyDate;
                            if (
                                !bestFaculty ||
                                effectiveDate < bestLastDutyDate
                            ) {
                                bestFaculty = faculty;
                                bestSchool = schoolUpper;
                                bestLastDutyDate = effectiveDate;
                            }
                        }
                    }
                }
            }

            if (bestFaculty) {
                const dutyInfo = {
                    date,
                    hostel: hostel.name,
                    roomAlloted: roomRange,
                    numberOfRooms: endRoom - currentRoomStart + 1
                };
                bestFaculty.lastDuty = dutyInfo;

                const list = facultyBySchool.get(bestSchool)?.[type];
                if (list) {
                    list.shift();
                    list.push(bestFaculty);
                }

                return bestFaculty;
            }

            // 2. Fallback: assign from any school, pick oldest duty
            let oldestFaculty = null;
            let oldestDate = null;

            for (const [school, groupObj] of facultyBySchool.entries()) {
                const facultyList = groupObj[type];
                if (facultyList.length === 0) continue;

                const faculty = facultyList[0];
                const lastDutyDate = new Date(faculty.lastDuty?.date);

                if (
                    !oldestFaculty ||
                    isNaN(lastDutyDate) ||
                    (oldestDate && lastDutyDate < oldestDate)
                ) {
                    oldestFaculty = faculty;
                    oldestDate = isNaN(lastDutyDate) ? new Date(0) : lastDutyDate;
                }
            }

            if (oldestFaculty) {
                const dutyInfo = {
                    date,
                    hostel: hostel.name,
                    roomAlloted: roomRange,
                    numberOfRooms: endRoom - currentRoomStart + 1
                };
                oldestFaculty.lastDuty = dutyInfo;

                // Remove from its school list and push to end
                const school = oldestFaculty.orgUnit?.toUpperCase();
                const facultyList = facultyBySchool.get(school)?.[type];
                if (facultyList) {
                    facultyList.shift();
                    facultyList.push(oldestFaculty);
                }

                return oldestFaculty;
            }

            // No one available
            return null;
        };

        // =================================================================
        // 2. ASSIGNMENT LOGIC (IN-MEMORY)
        // =================================================================

        const newAssignments = []; // For DutyAssignment.insertMany()
        const facultyUpdates = [];   // For Faculty.bulkWrite()
        const workbookData = {};     // To build Excel sheets in memory

        for (const hostel of hostels) {
            const hostelId = hostel._id.toString();
            const associatedSchools = Array.isArray(hostel.associatedSchools) ? hostel.associatedSchools.map(s => s.toUpperCase()) : [];
            console.log(`Processing hostel: ${hostel.name}, Associated Schools: ${associatedSchools.join(', ')}`);
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
                hostelRoomPointers.set(hostelId, endRoom); // Update pointer for next day/run

                // --- Select Faculty ---
                let currentTeachingFaculty, currentNonTeachingFaculty;

                // Find a teaching faculty
                currentTeachingFaculty = getAvailableFaculty(associatedSchools, date, hostel, roomRange, currentRoomStart, endRoom, 'teaching');
                currentNonTeachingFaculty = getAvailableFaculty(associatedSchools, date, hostel, roomRange, currentRoomStart, endRoom, 'nonTeaching');


                console.log("Selected Teaching Faculty:", currentTeachingFaculty.name, "group:", currentTeachingFaculty.employeeGroup, "school:", currentTeachingFaculty.orgUnit);
                console.log("Selected Non-Teaching Faculty:", currentNonTeachingFaculty.name, "group:", currentNonTeachingFaculty.employeeGroup, "school:", currentNonTeachingFaculty.orgUnit);

                if (!currentTeachingFaculty || !currentNonTeachingFaculty) {
                    console.warn(`Could not find available faculty for hostel ${hostel.name} on ${dateStr}. Skipping.`);
                    continue; // Skip this day if no faculty could be found
                }

                // --- Queue up the data for batch operations ---
                newAssignments.push({
                    school: currentTeachingFaculty.orgUnit,
                    date,
                    hostel: hostel.name,
                    roomRange,
                    faculty1: {
                        id: currentTeachingFaculty._id,
                        name: currentTeachingFaculty.name,
                        employeeGroup: currentTeachingFaculty.employeeGroup
                    },
                    faculty2: {
                        id: currentNonTeachingFaculty._id,
                        name: currentNonTeachingFaculty.name,
                        employeeGroup: currentNonTeachingFaculty.employeeGroup
                    }
                });

                const dutyInfo = { date, hostel: hostel.name, roomAlloted: roomRange, numberOfRooms: endRoom - currentRoomStart + 1 };


                facultyUpdates.push({
                    updateOne: { filter: { _id: currentTeachingFaculty._id }, update: { $set: { lastDuty: dutyInfo } } }
                });
                facultyUpdates.push({
                    updateOne: { filter: { _id: currentNonTeachingFaculty._id }, update: { $set: { lastDuty: dutyInfo } } }
                });

                // --- Add data for Excel sheet ---
                workbookData[hostel.name].push([
                    dateStr, hostel.name, roomRange, "Teaching", currentTeachingFaculty.name, currentTeachingFaculty.employeeCode, currentTeachingFaculty.designation, currentTeachingFaculty.orgUnit, currentTeachingFaculty.employeeGroup, currentTeachingFaculty.gender, currentTeachingFaculty.officialEmail, currentTeachingFaculty.personalEmail, currentTeachingFaculty.mobile
                ]);
                workbookData[hostel.name].push([
                    "", "", "", "Non-Teaching", currentNonTeachingFaculty.name, currentNonTeachingFaculty.employeeCode, currentNonTeachingFaculty.designation, currentNonTeachingFaculty.orgUnit, currentNonTeachingFaculty.employeeGroup, currentNonTeachingFaculty.gender, currentNonTeachingFaculty.officialEmail, currentNonTeachingFaculty.personalEmail, currentNonTeachingFaculty.mobile
                ]);
                workbookData[hostel.name].push([]); // Spacer row
            }
        }

        // =================================================================
        // 3. BATCH DATABASE WRITES (MAJOR OPTIMIZATION)
        // =================================================================
        if (newAssignments.length > 0) {
            await DutyAssignment.insertMany(newAssignments);
        }
        if (facultyUpdates.length > 0) {
            await Faculty.bulkWrite(facultyUpdates);
        }

        // =================================================================
        // 4. GENERATE EXCEL AND SEND RESPONSE
        // =================================================================
        for (const hostelName in workbookData) {
            if (workbookData[hostelName].length > 1) { // Only add sheets with data
                let sheetName = hostelName.slice(0, 31); // Ensure sheet name is not too long
                const sheet = xlsx.utils.aoa_to_sheet(workbookData[hostelName]);
                xlsx.utils.book_append_sheet(workbook, sheet, sheetName);
            }
        }

        const filePath = path.join(__dirname, `../duty-output-${Date.now()}.xlsx`); // Unique filename
        xlsx.writeFile(workbook, filePath);

        res.download(filePath, 'duty-schedule.xlsx', (err) => {
            if (err) {
                console.error('Download error:', err);
            }
            // Clean up the file after download
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
                Faculty.findById(faculty1Id),
                Faculty.findById(faculty2Id)
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