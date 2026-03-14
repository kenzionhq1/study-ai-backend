import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import {
  createUserMemory,
  findUserByEmailMemory,
} from "../store/memoryStore.js";
import { sendAdminSignupNotification } from "../services/notifyService.js";

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });

const useMemoryDb = () => process.env.USE_IN_MEMORY_DB === "true";

const toPublicUser = (user) => ({
  id: user._id?.toString?.() || user.id?.toString?.() || user.id,
  name: user.name,
  email: user.email,
});

// REGISTER
export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const exists = useMemoryDb()
      ? await findUserByEmailMemory(normalizedEmail)
      : await User.findOne({ email: normalizedEmail });
    if (exists) return res.status(409).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = useMemoryDb()
      ? await createUserMemory({
          name: String(name).trim(),
          email: normalizedEmail,
          password: hashedPassword,
        })
      : await User.create({
          name: String(name).trim(),
          email: normalizedEmail,
          password: hashedPassword,
        });

    // fire-and-forget admin notification (if SMTP + ADMIN_EMAILS configured)
    sendAdminSignupNotification({ name: user.name, email: user.email }).catch(() => {});

    return res.status(201).json({
      token: generateToken(user._id),
      user: toPublicUser(user),
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "User already exists" });
    }
    return res.status(500).json({ message: "Registration failed" });
  }
};

// LOGIN
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = useMemoryDb()
      ? await findUserByEmailMemory(normalizedEmail)
      : await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: "Invalid credentials" });

    return res.json({
      token: generateToken(user._id),
      user: toPublicUser(user),
    });
  } catch (err) {
    return res.status(500).json({ message: "Login failed" });
  }
};

// GET CURRENT USER
export const getMe = async (req, res) => {
  return res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
    },
  });
};
