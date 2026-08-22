// Must be the very first import — this runs dotenv.config() before any
// other module (connectDB, app, and everything THEY import) executes
// its own top-level code. In ES modules, an import's target module
// always fully runs before the importing file's own statements do,
// regardless of where those statements are textually placed relative
// to the import lines — so dotenv.config() previously ran too late to
// matter for anything reading process.env at module load time.
import "./loadEnv.js";

import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import connectDB from "./db/config.js";
import { app } from "./app.js";
import { initSocket } from "./socket/socket.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT;

const startServer = async () => {
  try {
    await connectDB();

    const server = http.createServer(app);
    initSocket(server);

    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("MongoDB Connection Failed:", error);
    process.exit(1);
  }
};

startServer();