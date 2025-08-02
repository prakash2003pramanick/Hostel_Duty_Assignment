const hostel = require("../models/hostel");

const addOrUpdateHostelManually = async (req, res) => {
    console.log("Received request to add or update hostel manually");

    try {
        const requests = Array.isArray(req.body) ? req.body : [req.body];
        const hostelsInRequest = requests.map(r => r.name);

        // Fetch all existing hostels in one go
        const existingHostelsMap = new Map(
            (await hostel.find({ name: { $in: hostelsInRequest } })).map(h => [h.name, h])
        );

        const operations = [];
        const responseHostels = [];

        for (const request of requests) {
            const {
                name,
                type,
                capacity,
                numberOfRooms,
                associatedSchools = [],
                nonAssociatedSchools = [],
                removeAssociatedSchools = [],
                removeNonAssociatedSchools = [],
                delete: deleteFlag
            } = request;

            const existingHostel = existingHostelsMap.get(name);

            // If delete flag is true and hostel exists, queue delete operation
            if (deleteFlag && existingHostel) {
                operations.push({
                    deleteOne: {
                        filter: { _id: existingHostel._id }
                    }
                });
                responseHostels.push({ name, deleted: true });
                continue;
            }

            // Compute final associated/nonAssociatedSchools if hostel already exists
            let finalAssociated = associatedSchools;
            let finalNonAssociated = nonAssociatedSchools;

            if (existingHostel) {
                finalAssociated = Array.from(new Set([
                    ...existingHostel.associatedSchools,
                    ...associatedSchools
                ])).filter(s => !removeAssociatedSchools.includes(s));

                finalNonAssociated = Array.from(new Set([
                    ...existingHostel.nonAssociatedSchools,
                    ...nonAssociatedSchools
                ])).filter(s => !removeNonAssociatedSchools.includes(s));
            }

            // Upsert operation (update if exists, insert if not)
            operations.push({
                updateOne: {
                    filter: { name },
                    update: {
                        $set: {
                            name,
                            type,
                            capacity,
                            numberOfRooms,
                            associatedSchools: finalAssociated,
                            nonAssociatedSchools: finalNonAssociated
                        }
                    },
                    upsert: true
                }
            });

            responseHostels.push({ name, upserted: true });
        }

        // Run all operations in one bulkWrite
        if (operations.length > 0) {
            await hostel.bulkWrite(operations);
        }

        res.status(200).json({
            message: "Hostel(s) processed successfully with bulk operation.",
            hostels: responseHostels
        });

    } catch (error) {
        console.error("Hostel bulk update error:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};

module.exports = {
    addOrUpdateHostelManually,
};
