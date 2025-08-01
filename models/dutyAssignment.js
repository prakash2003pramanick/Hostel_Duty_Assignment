// models/dutyAssignment.js
const mongoose = require('mongoose');

const DutySchema = new mongoose.Schema({
    school: { type: String, required: true },
    date: { type: Date, required: true },
    hostel: { type: String, required: true },
    roomRange: { type: String, required: true },
    faculty1: {
        id: { type: mongoose.Schema.Types.ObjectId, ref: 'Faculty' },
        name: String,
        employeeGroup: String,
    },
    faculty2: {
        id: { type: mongoose.Schema.Types.ObjectId, ref: 'Faculty' },
        name: String,
        employeeGroup: String,
    }
}, { timestamps: true });

DutySchema.index({ school: 1, date: 1, hostel: 1 }, { unique: true });

module.exports = mongoose.model('DutyAssignment', DutySchema);
