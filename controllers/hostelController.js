const xlsx = require('xlsx');
const Hostel = require('../models/hostel');
function normalizeKPHostelName(rawName) {
    const parts = rawName.trim().split('-');
    if (parts.length < 2) throw new Error(`Invalid KP hostel format in "${rawName}"`);

    const prefix = parts[0].toUpperCase();
    let blockPart = parts[1].toUpperCase().replace(/\s+/g, ' ').trim();

    let [roman, suffix] = blockPart.split(' ');
    if (!suffix && parts.length === 5) suffix = parts[2];

    let number = romanToInt(roman);
    if (!isNaN(number)) {
        return suffix ? `${prefix}-${number}${suffix}` : `${prefix}-${number}`;
    }

    for (let i = 1; i <= 2; i++) {
        roman = blockPart.slice(0, -i);
        suffix = blockPart.slice(-i);
        number = romanToInt(roman);
        if (!isNaN(number)) {
            return `${prefix}-${number}${suffix}`;
        }
    }

    throw new Error(`Failed to normalize KP hostel name "${rawName}"`);
}
// function normalizeQCHostelName(rawName) {
//     // Remove commas and extra spaces
//     rawName = rawName.replace(/,/g, '').replace(/\s+/g, ' ').trim();

//     const match = rawName.match(/^(QC[- ]?\d+[ A-Z]*|HOUSE - [A-Z])\s*,?\s*CAMPUS\s*-\s*\d+/i);
//     if (!match) throw new Error(`Invalid QC hostel format: "${rawName}"`);

//     const namePart = rawName.split(',')[0].trim();

//     // Normalize QC prefix spacing (e.g., "QC 6 G.H (A)" -> "QC-6 G.H (A)")
//     if (namePart.startsWith('QC')) {
//         return namePart.replace(/^QC\s*/, 'QC-').replace(/\s+/g, ' ').trim();
//     }

//     return namePart; // HOUSE-style, e.g., "HOUSE - G"
// }

function normalizeQCHostelName(rawName) {
    const [prefixPart, rest] = rawName.split('-');
    const prefix = prefixPart.trim().toUpperCase(); // e.g., QC or HOUSE

    if (!rest) throw new Error(`Invalid QC/HOUSE format: "${rawName}"`);

    // Split by comma: [ "6 G.H (A)", " CAMPUS -11" ]
    const [blockPartRaw] = rest.split(',');
    const blockPart = blockPartRaw.replace(/\s+/g, '').toUpperCase(); // remove all spaces

    return `${prefix}-${blockPart}`;
}

function normalizeHostelName(rawName) {
    rawName = rawName.trim();

    if (rawName.toUpperCase().startsWith('KP-')) {
        return normalizeKPHostelName(rawName);
    }

    if (rawName.toUpperCase().startsWith('QC') || rawName.toUpperCase().startsWith('HOUSE')) {
        return rawName;
    }

    throw new Error(`Unsupported hostel name format: "${rawName}"`);
}

// Helper
function romanToInt(roman) {
    const map = { I: 1, V: 5, X: 10, L: 50 };
    let total = 0;
    let prev = 0;
    for (let i = roman.length - 1; i >= 0; i--) {
        const curr = map[roman[i]];
        if (!curr) return NaN;
        total += curr < prev ? -curr : curr;
        prev = curr;
    }
    return total;
}



function getHostelType(rawName) {
    return rawName.startsWith('KP') ? 'BOYS' :
        rawName.startsWith('QC') ? 'GIRLS' : null;
}

function parseAssociatedSchools(raw) {
    if (!raw) return [];

    const result = [];
    const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    console.log("Lines to process:", lines);

    for (const line of lines) {
        if (/no student/i.test(line)) continue;

        const normalizedLine = line.replace(/\s+/g, ' ').trim();

        const yearPartMatch = normalizedLine.match(/((?:\d(?:st|nd|rd|th)\s*Yr|All Yr)(?:\s*&\s*(?:\d(?:st|nd|rd|th)\s*Yr))*)/i);
        const schoolPartMatch = normalizedLine.match(/((?:School|Institute|Engineering School)[^()]*|all\s+Engineering School)/i);

        console.log("Year part match:", yearPartMatch);
        console.log("School part match:", schoolPartMatch);

        if (!schoolPartMatch) continue;

        const school = schoolPartMatch[1]
            .trim()
            .replace(/[.,]+$/, '')              // remove trailing ., or , or both
            .replace(/\s+/g, ' ')               // normalize multiple spaces
            .replace(/[^A-Z0-9\s]/gi, '')       // remove stray symbols if any
            .toUpperCase();
        // const school = schoolPartMatch[1].trim().replace(/\.+$/, '').replace(/\s+/g, ' ').toUpperCase();
        const yearsRaw = yearPartMatch ? yearPartMatch[1] : 'All Yr';

        const years = yearsRaw
            .split(/\s*&\s*/)
            .map(y => y.trim().toUpperCase())
            .filter(Boolean);

        for (const year of years) {
            result.push({ year, school });
        }
    }

    return result;
}



const updateHostel = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded. Use field name "hostelFile".' });
    }

    console.log("file is present");

    try {

        const workbook = xlsx.readFile(req.file.path);
        console.log("Workbook read successfully");
        console.log("Sheet names:", workbook.SheetNames);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        const hostelData = xlsx.utils.sheet_to_json(worksheet, {
            header: ['slNo', 'name', 'capacity', 'associatedSchoolsRaw', 'numberOfRooms'],
            range: 1
        });

        const cleanedData = hostelData.filter(row =>
            row.name &&
            (
                row.name.toUpperCase().startsWith('KP') ||
                row.name.toUpperCase().startsWith('QC')
            )
        );

        // console.log("Cleaned data", cleanedData);

        const operations = cleanedData.map(row => {
            const normalizedName = normalizeHostelName(row.name);
            const hostelType = getHostelType(row.name);
            const parsedSchools = parseAssociatedSchools(row.associatedSchoolsRaw);

            return {
                updateOne: {
                    filter: { name: normalizedName },
                    update: {
                        $set: {
                            name: normalizedName,
                            capacity: row.capacity,
                            numberOfRooms: row.numberOfRooms,
                            associatedSchools: parsedSchools,
                            type: hostelType
                        }
                    },
                    upsert: true
                }
            };
        });

        if (operations.length === 0) {
            return res.status(400).json({ message: "No valid data found." });
        }

        // console.log("cleaned data", operations);

        const result = await Hostel.bulkWrite(operations);

        // console.log("Bulk operation result:", result);

        res.status(200).json({
            message: "Hostel data updated successfully.",
            created: result.upsertedCount,
            updated: result.modifiedCount
        });
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};

module.exports = {
    updateHostel,
};
