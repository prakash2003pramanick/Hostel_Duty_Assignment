// routes/uploadRoute.js
const express = require("express");
const router = express.Router();
const upload = require("../utils/upload");
const { addEmployeesFromExcel } = require("../controllers/uploadController");
const { assignDuties } = require("../controllers/assignDutyController");
const { generateFacultyDutyReport, generateFacultyDutyFrequency } = require("../controllers/dutyReport");
const { updateSettings, getSettings } = require("../controllers/updateSettings");

// Example controller
router.post("/upload/add_employee", upload.single("excelFile"), addEmployeesFromExcel);
router.post("/duty/assign_duty", assignDuties);
router.post("/duty/frequency", generateFacultyDutyFrequency);
router.get("/duty/report/:empCode", generateFacultyDutyReport);
router.put("/settings", updateSettings);
router.get("/settings", getSettings);


// router.post("/upload/delete_employee", upload.single("excelFile"), (req, res) => {
//   if (!req.file) return res.status(400).json({ message: "No file uploaded" });

//   res.status(200).json({
//     message: "File uploaded successfully",
//     filePath: req.file.path,
//   });
// });
// router.post("/upload/on_leave", upload.single("excelFile"), (req, res) => {
//   if (!req.file) return res.status(400).json({ message: "No file uploaded" });

//   res.status(200).json({
//     message: "File uploaded successfully",
//     filePath: req.file.path,
//   });
// });

module.exports = router;
