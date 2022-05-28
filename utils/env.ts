/**
 * This is to make dotenv work with ES6
 */
import { resolve } from "path";
import { config } from "dotenv";

config({ path: resolve(__dirname, "../.env") });
