const mongoose = require('mongoose');

const SettingSchema = new mongoose.Schema({
    boysHostel: { type: Number, required: true },
    girlsHostel: { type: Number, required: true },
});

module.exports = mongoose.model('Setting', SettingSchema);
