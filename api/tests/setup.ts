import { beforeAll, afterAll, afterEach } from "vitest";
import "./emailDeliveryMock.js";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

// Legacy endpoint tests opt into simulated plan changes. Production always
// rejects this flag, even when it is explicitly enabled.
process.env.NODE_ENV ??= "test";
process.env.ALLOW_SIMULATED_UPGRADES ??= "true";

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.connection.close();
  await replSet.stop();
});
