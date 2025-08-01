const xlsx = require('xlsx');
const Faculty = require('../models/faculty');

const updateFaculty = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded. Use field name "facultyFile".' });
    }

    try {
        const workbook = xlsx.readFile(req.file.path);
        const sheetNames = workbook.SheetNames;

        const writePromises = [];

        for (const sheetName of sheetNames) {
            const sheet = workbook.Sheets[sheetName];

            const facultyData = xlsx.utils.sheet_to_json(sheet, {
                header: [
                    'employeeCode', 'title', 'name', 'designation',
                    'orgUnit', 'employeeGroup', 'gender',
                    'personalEmail', 'officialEmail', 'mobile'
                ],
                range: 1 // skip header row
            });

            const cleaned = facultyData.filter(row =>
                row.employeeCode && row.name && row.designation
            );

            if (cleaned.length === 0) continue;

            const operations = cleaned.map(row => ({
                updateOne: {
                    filter: { employeeCode: row.employeeCode },
                    update: {
                        $set: {
                            title: row.title?.trim(),
                            name: row.name?.trim(),
                            designation: row.designation?.trim(),
                            orgUnit: row.orgUnit?.trim(),
                            employeeGroup: row.employeeGroup?.trim(),
                            gender: row.gender?.trim(),
                            personalEmail: row.personalEmail?.trim()?.toLowerCase(),
                            officialEmail: row.officialEmail?.trim()?.toLowerCase(),
                            mobile: row.mobile
                        }
                    },
                    upsert: true
                }
            }));

            // Don't await here — push to promises array
            writePromises.push(
                Faculty.bulkWrite(operations).then(result => ({
                    sheet: sheetName,
                    upserted: result.upsertedCount,
                    modified: result.modifiedCount
                })).catch(err => ({
                    sheet: sheetName,
                    error: err.message
                }))
            );

            console.log(`Processed sheet: ${sheetName}, Upserted: ${operations.length}`);
        }

        if (writePromises.length === 0) {
            return res.status(400).json({ message: "No valid faculty data found in sheets." });
        }

        // Wait for all write operations to complete
        const results = await Promise.allSettled(writePromises);

        const summary = results.map((res, i) => {
            if (res.status === 'fulfilled') {
                return {
                    sheet: sheetNames[i],
                    upserted: res.value.upserted,
                    modified: res.value.modified
                };
            } else {
                return {
                    sheet: sheetNames[i],
                    error: res.reason
                };
            }
        });

        res.status(200).json({
            message: "Faculty data processed.",
            results: summary
        });

    } catch (error) {
        console.error("Faculty import error:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

module.exports = {
    updateFaculty
};
