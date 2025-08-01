const mongoose = require('mongoose');

const HostelSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Hostel name is required'],
        unique: true,
        trim: true
    },
    capacity: {
        type: Number,
        required: [true, 'Capacity is required']
    },
    numberOfRooms: {
        type: Number,
        required: [true, 'Number of rooms is required']
    },
    associatedSchools: [{
        year: String,
        school: String
    }],
    type: {
        type: String,
        enum: ['BOYS', 'GIRLS'],
        required: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Hostel', HostelSchema);
