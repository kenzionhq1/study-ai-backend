import express from "express";
import dns from "node:dns";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";

import authRoutes from "./src/routes/auth.js";
import topicRoutes from "./src/routes/topics.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const DNS_DOH_ENDPOINT =
  process.env.DNS_DOH_ENDPOINT || "https://cloudflare-dns.com/dns-query";
const ALLOW_IN_MEMORY_DB = process.env.ALLOW_IN_MEMORY_DB !== "false";
const AI_PROVIDER = (process.env.AI_PROVIDER || "local").toLowerCase();

const validateEnv = () => {
  const missing = [];

  if (!process.env.JWT_SECRET) missing.push("JWT_SECRET");
  if (!ALLOW_IN_MEMORY_DB && !process.env.MONGO_URI) missing.push("MONGO_URI");
  if (AI_PROVIDER === "openai" && !process.env.OPENAI_API_KEY) {
    missing.push("OPENAI_API_KEY");
  }
  if (AI_PROVIDER === "groq" && !process.env.GROQ_API_KEY) {
    missing.push("GROQ_API_KEY");
  }
  if (!["local", "openai", "groq"].includes(AI_PROVIDER)) {
    throw new Error('AI_PROVIDER must be one of: "local", "openai", "groq"');
  }

  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
};

try {
  validateEnv();
} catch (err) {
  console.error(`❌ Startup configuration error: ${err.message}`);
  process.exit(1);
}

if (process.env.DNS_SERVERS) {
  const dnsServers = process.env.DNS_SERVERS
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);
  if (dnsServers.length) {
    dns.setServers(dnsServers);
    console.log(`Using custom DNS servers: ${dnsServers.join(", ")}`);
  }
}
dns.setDefaultResultOrder("ipv4first");

const safeDecode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const fetchDnsAnswers = async (name, type) => {
  const url = new URL(DNS_DOH_ENDPOINT);
  url.searchParams.set("name", name);
  url.searchParams.set("type", type);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(url, {
      headers: { accept: "application/dns-json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`DoH request failed with status ${response.status}`);
    }

    const payload = await response.json();
    if (payload.Status !== 0) {
      throw new Error(`DoH lookup failed for ${name} (${type})`);
    }

    return payload.Answer || [];
  } finally {
    clearTimeout(timeout);
  }
};

const buildMongoUriFromSrv = async (srvUri) => {
  const parsed = new URL(srvUri);
  const srvRecordName = `_mongodb._tcp.${parsed.hostname}`;

  const srvAnswers = await fetchDnsAnswers(srvRecordName, "SRV");
  const hosts = srvAnswers
    .map((answer) => String(answer.data).trim().split(/\s+/))
    .filter((parts) => parts.length >= 4)
    .map((parts) => `${parts[3].replace(/\.$/, "")}:${parts[2]}`);

  if (!hosts.length) {
    throw new Error("No SRV hosts returned for MongoDB cluster");
  }

  let txtParams = new URLSearchParams();
  try {
    const txtAnswers = await fetchDnsAnswers(parsed.hostname, "TXT");
    const txtRaw = txtAnswers.map((answer) => String(answer.data)).join("");
    const txtString = txtRaw.replace(/"/g, "");
    txtParams = new URLSearchParams(txtString);
  } catch {
    txtParams = new URLSearchParams();
  }

  const mergedParams = new URLSearchParams();
  for (const [key, value] of txtParams.entries()) {
    mergedParams.set(key, value);
  }
  for (const [key, value] of parsed.searchParams.entries()) {
    mergedParams.set(key, value);
  }
  if (!mergedParams.has("tls") && !mergedParams.has("ssl")) {
    mergedParams.set("tls", "true");
  }

  const username = parsed.username
    ? encodeURIComponent(safeDecode(parsed.username))
    : "";
  const password = parsed.password
    ? encodeURIComponent(safeDecode(parsed.password))
    : "";
  const auth = username ? `${username}${password ? `:${password}` : ""}@` : "";
  const dbPath = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "/";
  const query = mergedParams.toString();

  return `mongodb://${auth}${hosts.join(",")}${dbPath}${query ? `?${query}` : ""}`;
};

// Middleware
const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);
if (process.env.FRONTEND_ORIGINS) {
  for (const origin of process.env.FRONTEND_ORIGINS.split(",")) {
    const trimmed = origin.trim();
    if (trimmed) allowedOrigins.add(trimmed);
  }
}
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS origin not allowed"));
    },
    credentials: true,
  })
);
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/topics", topicRoutes);

// Test route
app.get("/", (req, res) => res.send("API Running"));

const connectMongo = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing in .env");
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB Connected");
    return;
  } catch (err) {
    const isSrvDnsError =
      err?.syscall === "querySrv" ||
      err?.syscall === "queryTxt" ||
      err?.code === "ECONNREFUSED" ||
      err?.code === "ENOTFOUND" ||
      err?.code === "ETIMEOUT";

    if (isSrvDnsError && process.env.MONGO_URI_FALLBACK) {
      try {
        console.warn("Primary Mongo URI failed. Trying MONGO_URI_FALLBACK...");
        await mongoose.connect(process.env.MONGO_URI_FALLBACK);
        console.log("✅ MongoDB Connected (fallback URI)");
        return;
      } catch (fallbackErr) {
        console.error("Fallback URI failed:", fallbackErr.message);
      }
    }

    if (isSrvDnsError && process.env.MONGO_URI.startsWith("mongodb+srv://")) {
      try {
        console.warn("Trying DNS-over-HTTPS MongoDB fallback...");
        const derivedUri = await buildMongoUriFromSrv(process.env.MONGO_URI);
        await mongoose.connect(derivedUri);
        console.log("✅ MongoDB Connected (DoH fallback)");
        return;
      } catch (dohErr) {
        console.error("DoH fallback failed:", dohErr.message);
      }
    }

    throw err;
  }
};

const startServer = async () => {
  const listen = (label = "") => {
    const server = app.listen(PORT, () =>
      console.log(`🚀 Server running on port ${PORT}${label}`)
    );
    server.on("error", (listenErr) => {
      console.error("❌ Server failed to start:", listenErr.message);
      process.exit(1);
    });
  };

  try {
    await connectMongo();
    listen();
  } catch (err) {
    if (ALLOW_IN_MEMORY_DB) {
      process.env.USE_IN_MEMORY_DB = "true";
      console.warn("⚠️ MongoDB unavailable. Starting with in-memory fallback datastore.");
      console.warn(`Mongo error: ${err.message}`);
      listen(" (memory mode)");
      return;
    }
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
};

startServer();
