import express from "express";
import User from "../models/User.js";
import Topic from "../models/Topic.js";
import TokenUsage from "../models/TokenUsage.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

const getRangeWindow = (range, from, to) => {
  if (from && to) {
    const start = new Date(from);
    const end = new Date(to);
    if (!isNaN(start) && !isNaN(end)) return { start, end };
  }
  const now = new Date();
  const start = new Date(now);
  switch (range) {
    case "day":
      start.setHours(0, 0, 0, 0);
      break;
    case "week":
      start.setDate(start.getDate() - 7);
      break;
    case "month":
      start.setMonth(start.getMonth() - 1);
      break;
    case "year":
      start.setFullYear(start.getFullYear() - 1);
      break;
    default:
      return { start: null, end: null };
  }
  return { start, end: now };
};

const getAdminEmails = () =>
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

const requireAdmin = (req, res, next) => {
  const adminEmails = getAdminEmails();
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });
  const userEmail = (req.user.email || "").toLowerCase();
  if (!adminEmails.includes(userEmail)) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
};

router.get("/stats", protect, requireAdmin, async (_req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const topicsGenerated = await Topic.countDocuments();
    const totalTokensUsed = await TokenUsage.aggregate([
      { $group: { _id: null, total: { $sum: "$totalTokens" } } },
    ]).then((r) => (r[0]?.total || 0));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const activeToday = (
      await Topic.distinct("userId", { createdAt: { $gte: today } })
    ).length;

    const week = new Date();
    week.setDate(week.getDate() - 7);
    const signupsThisWeek = await User.countDocuments({ createdAt: { $gte: week } });

    res.json({
      totalUsers,
      topicsGenerated,
      activeToday,
      signupsThisWeek,
      totalTokensUsed,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch admin stats" });
  }
});

// Time-series metrics with filters
// GET /api/admin/analytics?range=day|week|month|year or ?from=ISO&to=ISO
router.get("/analytics", protect, requireAdmin, async (req, res) => {
  try {
    const { range = "week", from, to } = req.query;
    const { start, end } = getRangeWindow(range, from, to);

    const dateFilter = start && end ? { createdAt: { $gte: start, $lte: end } } : {};

    const [usersByDay, topicsByDay, tokensByDay] = await Promise.all([
      User.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Topic.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      TokenUsage.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            tokens: { $sum: "$totalTokens" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    res.json({ usersByDay, topicsByDay, tokensByDay });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch analytics" });
  }
});

router.get("/users", protect, requireAdmin, async (_req, res) => {
  try {
    const users = await User.aggregate([
      { $project: { id: "$_id", name: 1, email: 1, createdAt: 1 } },
      {
        $lookup: {
          from: "topics",
          localField: "_id",
          foreignField: "userId",
          as: "topics",
        },
      },
      {
        $lookup: {
          from: "tokenusages",
          localField: "_id",
          foreignField: "userId",
          as: "usage",
        },
      },
      {
        $addFields: {
          tokensUsed: { $sum: "$usage.totalTokens" },
          topicsCount: { $size: "$topics" },
        },
      },
      { $project: { topics: 0, usage: 0 } },
      { $sort: { createdAt: -1 } },
    ]);
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

export default router;
