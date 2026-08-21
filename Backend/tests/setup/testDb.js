import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

// Each test FILE gets its own isolated in-memory MongoDB instance —
// avoids cross-file pollution and Jest's parallel-worker port clashes.
let mongod;

export const connectTestDb = async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
};

export const clearTestDb = async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
};

export const disconnectTestDb = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  if (mongod) await mongod.stop();
};
