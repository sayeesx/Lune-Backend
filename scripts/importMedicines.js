import "dotenv/config.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import csv from "csv-parser";
import dbConnect from "../lib/mongodb.js";
import Medicine from "../models/Medicine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_FILES = [
  path.join(__dirname, "..", "indian_medicine_data.csv"),
  path.join(__dirname, "..", "updated_indian_medicine_data.csv"),
];
const JSON_FILE = path.join(__dirname, "..", "indian_medicine_data.json");

const toBool = (v) => {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y";
};
const mapRow = (row) => {
  const num = (x) => {
    const n = parseFloat(String(x ?? "").replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const int = (x) => {
    const n = parseInt(String(x ?? "").replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    id: int(row.id),
    name: (row.name ?? row.medicine_name ?? "").toString().trim(),
    price: num(row.price),
    is_discontinued: toBool(row.is_discontinued),
    manufacturer_name: (row.manufacturer_name ?? row.manufacturer ?? "").toString().trim(),
    type: (row.type ?? row.category ?? "").toString().trim(),
    pack_size_label: (row.pack_size_label ?? row.pack_size ?? "").toString().trim(),
    short_composition1: (row.short_composition1 ?? row.composition1 ?? "").toString().trim(),
    short_composition2: (row.short_composition2 ?? row.composition2 ?? "").toString().trim(),
  };
};
const readCsv = (filePath) => new Promise((resolve, reject) => {
  if (!fs.existsSync(filePath)) return resolve([]);
  const rows = [];
  fs.createReadStream(filePath).pipe(csv())
    .on("data", (d) => rows.push(d))
    .on("end", () => resolve(rows))
    .on("error", (e) => reject(e));
});
const readJson = (filePath) => {
  if (!fs.existsSync(filePath)) return [];
  try { const data = JSON.parse(fs.readFileSync(filePath, "utf8")); return Array.isArray(data) ? data : []; }
  catch { return []; }
};
const batchInsert = async (docs, batchSize = 1000) => {
  for (let i = 0; i < docs.length; i += batchSize) {
    const chunk = docs.slice(i, i + batchSize);
    if (chunk.length) await Medicine.insertMany(chunk, { ordered: false });
  }
};

(async () => {
  await dbConnect();
  await Medicine.deleteMany({});
  let merged = [];
  for (const f of CSV_FILES) merged = merged.concat(await readCsv(f));
  merged = merged.concat(readJson(JSON_FILE));
  if (!merged.length) { console.log("No data to import."); process.exit(0); }
  const mapped = merged.map(mapRow).filter(d => d && d.name);
  const byId = new Map();
  for (const d of mapped) { if (d.id !== undefined) byId.set(d.id, d); }
  const finalDocs = byId.size ? Array.from(byId.values()) : mapped;
  await batchInsert(finalDocs);
  await Medicine.createIndexes();
  console.log("Import complete");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
