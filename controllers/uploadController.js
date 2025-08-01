const XLSX = require("xlsx");
const Faculty = require("../models/faculty");
const fs = require("fs");
const path = require("path");

const addEmployeesFromExcel = async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    const headers = rawData[0];
    const dataRows = rawData.slice(1);

    const cleanHeaders = headers.map(key =>
        key.toString().replace(/\./g, '').replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '')
    );

    const data = dataRows.map(row => {
        const obj = {};
        cleanHeaders.forEach((key, i) => {
            obj[key] = row[i];
        });
        return obj;
    });

    const bulkOperations = [];
    const statusData = [];

    for (const row of data) {
        const empCode = row["EmpCode"];
        const name = row["Name"];

        if (!empCode || !name) {
            statusData.push({ ...row, status: "Missing data: EmpCode or Name" });
            continue;
        }

        const doc = {
            empCode: String(empCode),
            title: row["Title"] || "",
            name,
            designation: row["Designation"] || "",
            department: row["Department"] || "",
            emailId: row["EmailID"] || "",
            gender: row["Gender"] || "MALE",
            mobNo: row["MobNo"] ? String(row["MobNo"]) : "",
            type: row["Type"] || (name?.endsWith("(Coordinator)") ? "Teaching" : "Non-Teaching"),
            onLeave: row["OnLeave"] === "TRUE" || row["OnLeave"] === true,
            leave: {
                startDate: row["startDate"] ? new Date(row["startDate"]) : null,
                endDate: row["endDate"] ? new Date(row["endDate"]) : null,
                reason: row["reason"] || "",
            },
        };

        bulkOperations.push({
            updateOne: {
                filter: { empCode },
                update: { $set: doc, $setOnInsert: { lastDuty: [] } },
                upsert: true,
            },
        });

        statusData.push({ ...row, status: "Processed (Inserted or Updated)" });
    }

    try {
        if (bulkOperations.length > 0) {
            await Faculty.bulkWrite(bulkOperations);
        }

        const newSheet = XLSX.utils.json_to_sheet(statusData);
        const newWorkbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWorkbook, newSheet, "Status");

        const outputPath = path.join(__dirname, "../outputs", `processed_${Date.now()}.xlsx`);
        XLSX.writeFile(newWorkbook, outputPath);

        res.download(outputPath, err => {
            // Clean up both uploaded and output files after response
            fs.unlink(filePath, () => { });
            fs.unlink(outputPath, () => { });
            if (err) console.error('Error sending file:', err);
        });
    } catch (err) {
        console.error(err);
        // Cleanup uploaded file even on error
        fs.unlink(filePath, () => { });
        res.status(500).json({ message: "Bulk operation failed", error: err.message });
    }
};

module.exports = {
    addEmployeesFromExcel,
};
