// routes/uploadRoute.js
const express = require("express");
const router = express.Router();
const upload = require("../utils/upload");
const { addEmployeesFromExcel } = require("../controllers/addEmployeesFromExcel");
const { assignDuties, assignDutiesManually } = require("../controllers/assignDutyController");
const { generateFacultyDutyReport, generateFacultyDutyFrequency } = require("../controllers/dutyReport");
const { updateSettings, getSettings } = require("../controllers/updateSettings");
const { updateHostel } = require("../controllers/hostelController");
const { updateFaculty } = require("../controllers/facultyController");
const { addOrUpdateHostelManually } = require("../controllers/addOrUpdateHostelController");
const { addOrUpdateGroupManually } = require("../controllers/addOrUpdateGroupController");

// Example controller
router.post("/hoste/add-or-update-manually", addOrUpdateHostelManually);
router.post("/group/add-or-update-manually", addOrUpdateGroupManually);
router.post("/upload/add_employee", upload.single("excelFile"), addEmployeesFromExcel);
router.post("/duty/assign_duty", assignDuties);
router.post("/duty/assign_duty_manually", assignDutiesManually);
router.post("/duty/frequency", generateFacultyDutyFrequency);
router.get("/duty/report/:empCode", generateFacultyDutyReport);
router.put("/settings", updateSettings);
router.get("/settings", getSettings);
router.post("/upload/hostel", upload.single("hostelFile"), updateHostel);
router.post("/upload/faculty", upload.single("facultyFile"), updateFaculty);

module.exports = router;
