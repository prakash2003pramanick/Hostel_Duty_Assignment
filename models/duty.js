const mongoose = require('mongoose');

const DutySchema = new mongoose.Schema({
    month: { type: String, required: true },
    year: { type: String, required: true },
    duty: { type: mongoose.Schema.Types.Mixed, required: true },
});

module.exports = mongoose.model('Duty', DutySchema);
