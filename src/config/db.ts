import mongoose from "mongoose";
import dns from "dns";

const connectDb = async () => {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
    const url = process.env.MONGO_URL;

    if (!url) {
        throw new Error("MONGO_URL is not defined");
    }

    try {
        await mongoose.connect(url, {
            dbName: "nrapp"
        });
        console.log("Connected to MongoDB");
    } catch (error) {
        console.log("Failed to connect to MongoDB", error);
        process.exit(1);
    }
}

export default connectDb;