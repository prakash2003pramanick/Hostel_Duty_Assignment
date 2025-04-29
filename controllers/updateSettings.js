const Setting = require('../models/settings');

const updateSettings = async (req, res) => {
    try {
        let { boysHostel, girlsHostel } = req.body;

        boysHostel = parseInt(boysHostel);
        girlsHostel = parseInt(girlsHostel);
        if (isNaN(boysHostel) || isNaN(girlsHostel)) {
            return res.status(400).json({ message: 'Invalid input' });
        }
        const settings = await Setting.findOne();
        if (!settings) {
            const newSettings = new Setting({ boysHostel, girlsHostel });
            await newSettings.save();
            return res.status(201).json({ message: 'Settings created successfully', settings: newSettings });
        } else {
            settings.boysHostel = boysHostel;
            settings.girlsHostel = girlsHostel;
            await settings.save();
            return res.status(200).json({ message: 'Settings updated successfully', settings });
        }
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}
const getSettings = async (req, res) => {
    try {
        const settings = await Setting.findOne();
        if (!settings) {
            return res.status(404).json({ message: 'Settings not found' });
        }
        return res.status(200).json({ message: 'Settings retrieved successfully', settings });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}
module.exports = {
    updateSettings,
    getSettings
};