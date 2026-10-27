import { existsSync, rmSync } from "node:fs";
import { loadConfig } from "../config.js";
import { openDatabase } from "../database.js";

const config = loadConfig();
if (config.databasePath !== ":memory:" && existsSync(config.databasePath)) rmSync(config.databasePath);
const database = openDatabase(config.databasePath);
database.close();
console.log(`Reset and seeded ${config.databasePath}`);
