const mongoose = require('mongoose');

const FacultySchema = new mongoose.Schema({
  empCode: { type: String, unique: true },
  title: String,
  name: String,
  designation: String,
  department: String,
  emailId: String,
  mobNo: String,
  gender: { type: String, default: "MALE", enum: ["MALE", "FEMALE"] },
  lastDuty: [
    {
      date: Date,
      group: String,
    }
  ],
  leave: {
    startDate: { type: Date },
    endDate: { type: Date },
    reason: { type: String }
  },
  type: { type: String, enum: ['Teaching', 'Non-Teaching', 'Staff'], default: 'Teaching' },
  onLeave: { type: Boolean, default: false },
});

module.exports = mongoose.model('Faculty', FacultySchema);
