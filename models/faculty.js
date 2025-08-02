// models/faculty.js
const mongoose = require('mongoose');

const facultySchema = new mongoose.Schema({
  employeeCode: { type: String, required: true, unique: true },
  title: String,
  name: String,
  designation: String,
  orgUnit: String,
  employeeGroup: String,
  gender: String,
  personalEmail: String,
  officialEmail: String,
  mobile: String,
  lastDuty:
  {
    date: Date,
    hostel: String,
    roomAlloted: String,
    numberOfRooms: Number,
  }
  ,
  leave: [{
    startDate: { type: Date },
    endDate: { type: Date },
    reason: { type: String }
  }]
}, { timestamps: true });

module.exports = mongoose.model('Faculty', facultySchema);
