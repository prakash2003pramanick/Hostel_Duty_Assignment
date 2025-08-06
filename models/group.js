const mongoose = require('mongoose');

const GroupSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Group name is required'],
        unique: true,
        trim: true
    },
    hostelName: [{
        type: String,
        required: [true, 'Hostel name is required'],
        trim: true
    }],
    numberOfFacutlyPerDay: {
        type: Number,
        required: [true, 'Number of faculty per day is required']
    },
    type: {
        type: String,
        enum: ['BOYS', 'GIRLS'],
        required: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Group', GroupSchema);
