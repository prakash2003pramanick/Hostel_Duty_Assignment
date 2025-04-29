const mongoose = require('mongoose');

const DutySchema = new mongoose.Schema({
    duty: { type: mongoose.Schema.Types.Mixed, required: true },
    reqBody: { type: mongoose.Schema.Types.Mixed, required: true },
});

module.exports = mongoose.model('Duty', DutySchema);
