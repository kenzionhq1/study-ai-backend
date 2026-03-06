import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { findUserByIdMemory } from "../store/memoryStore.js";

const useMemoryDb = () => process.env.USE_IN_MEMORY_DB === "true";

export const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const tokenFromAuthHeader = String(authHeader).match(/^Bearer\s+(.+)$/i)?.[1];
  const tokenFromLegacyHeader = req.headers["x-auth-token"] || req.headers["auth-token"];
  const token = tokenFromAuthHeader || tokenFromLegacyHeader;

  if (!token) {
    return res.status(401).json({ message: "Not authorized, token missing" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = useMemoryDb()
      ? await findUserByIdMemory(decoded.id)
      : await User.findById(decoded.id).select("name email");
    if (!user) return res.status(401).json({ message: "Not authorized, user not found" });

    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ message: "Not authorized, token invalid" });
  }
};

export default protect;
