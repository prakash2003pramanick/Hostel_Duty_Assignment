const Group = require("../models/group");
const Hostel = require("../models/hostel");

const addOrUpdateGroupManually = async (req, res) => {
    console.log("Received request to add or update group manually");

    try {
        const requests = Array.isArray(req.body) ? req.body : [req.body];
        const allHostelsInRequests = [...new Set(requests.flatMap(r => r.hostelName || []))];

        // Fetch all hostels mentioned in any request
        const existingHostelsSet = new Set(
            (await Hostel.find({ name: { $in: allHostelsInRequests } })).map(h => h.name)
        );

        const operations = [];
        const responseGroups = [];

        for (const request of requests) {
            const {
                name,
                hostelName = [],
                numberOfFacutlyPerDay,
                type,
                delete: deleteFlag
            } = request;

            if (!name) {
                responseGroups.push({ error: "Group name is required." });
                continue;
            }

            const invalidHostels = hostelName.filter(h => !existingHostelsSet.has(h));
            if (invalidHostels.length > 0) {
                responseGroups.push({
                    name,
                    error: `Invalid hostel(s): ${invalidHostels.join(", ")}`
                });
                continue;
            }

            const existingGroup = await Group.findOne({ name });

            if (deleteFlag && existingGroup) {
                // Remove only specified hostels from the group
                const updatedHostels = existingGroup.hostelName.filter(h => !hostelName.includes(h));

                if (updatedHostels.length === 0) {
                    // If no hostels left, delete the group
                    operations.push({
                        deleteOne: {
                            filter: { _id: existingGroup._id }
                        }
                    });
                    responseGroups.push({ name, deleted: true, reason: "All hostels removed" });
                } else {
                    operations.push({
                        updateOne: {
                            filter: { _id: existingGroup._id },
                            update: { $set: { hostelName: updatedHostels } }
                        }
                    });
                    responseGroups.push({ name, updated: true, removedHostels: hostelName });
                }

                continue;
            }

            // If group exists: update it (merge hostels), else create new
            const finalHostelNames = existingGroup
                ? Array.from(new Set([...existingGroup.hostelName, ...hostelName]))
                : hostelName;

            operations.push({
                updateOne: {
                    filter: { name },
                    update: {
                        $set: {
                            name,
                            hostelName: finalHostelNames,
                            numberOfFacutlyPerDay,
                            type
                        }
                    },
                    upsert: true
                }
            });

            responseGroups.push({ name, upserted: true });
        }

        if (operations.length > 0) {
            await Group.bulkWrite(operations);
        }

        res.status(200).json({
            message: "Group(s) processed successfully.",
            groups: responseGroups
        });

    } catch (error) {
        console.error("Group bulk update error:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};

module.exports = {
    addOrUpdateGroupManually,
};
