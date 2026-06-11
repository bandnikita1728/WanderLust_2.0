require("../utils/mongoMock"); // Patches mongoose dynamically to fall back to in-memory file DB if local MongoDB is unreachable
const mongoose = require("mongoose");
const initData = require("./data.js");
const Listing = require("../models/listing.js");

const MONGO_URL = "mongodb://127.0.0.1:27017/wanderlust";

async function main() {
  try {
    await mongoose.connect(MONGO_URL);
    console.log("Connected to DB");
    await initDB();
  } catch (err) {
    console.error("Database connection/init error:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from DB");
  }
}

async function initDB() {
  await Listing.deleteMany({});
  
  // Assign a static 24-character hexadecimal dummy User ID to the owner field of each listing.
  const initListings = initData.data.map((obj) => ({
    ...obj,
    owner: "65c3b1740989f668393e8bf0",
  }));
  
  await Listing.insertMany(initListings);
  console.log("DB initialized");
}

main();
