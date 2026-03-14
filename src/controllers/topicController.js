import mongoose from "mongoose";
import Topic from "../models/Topic.js";
import TokenUsage from "../models/TokenUsage.js";
import {
  AIProviderUnavailableError,
  generateTopicWithAI,
  moderateTopicWithAI,
} from "../services/aiService.js";
import {
  createTopicMemory,
  findTopicByIdForUserMemory,
  findTopicByUserAndNameMemory,
  findTopicsByUserMemory,
} from "../store/memoryStore.js";
import { analyzeTopicSafety } from "../utils/topicSafety.js";

const useMemoryDb = () => process.env.USE_IN_MEMORY_DB === "true";
const asObject = (value) => (value?.toObject ? value.toObject() : { ...value });

// Generate topic
export const generateTopic = async (req, res) => {
  try {
    const topicInput = req.body?.topic ?? req.body?.title ?? req.body?.prompt ?? "";
    const userId = req.user.id;
    const safety = analyzeTopicSafety(topicInput);

    if (safety.flagged) {
      return res.status(400).json({
        message: safety.message || "This topic is not allowed",
        flagged: true,
        code: safety.code,
        reason: safety.reason,
      });
    }
    const aiSafety = await moderateTopicWithAI(safety.cleanedTopic);
    if (aiSafety.flagged) {
      return res.status(400).json({
        message: aiSafety.message || "This topic is not allowed",
        flagged: true,
        code: aiSafety.code || "INAPPROPRIATE_TOPIC",
        reason: aiSafety.reason || "blocked_by_ai_guard",
      });
    }

    const normalizedTopic = safety.cleanedTopic.toLowerCase();

    const existing = useMemoryDb()
      ? await findTopicByUserAndNameMemory({ userId, topic: normalizedTopic })
      : await Topic.findOne({ userId, topic: normalizedTopic });
    if (existing) {
      const payload = asObject(existing);
      return res.json({ ...payload, source: "library", flagged: false });
    }

    const aiResult = await generateTopicWithAI(safety.cleanedTopic);
    const source = aiResult?.source || "openai";

    const newTopic = useMemoryDb()
      ? await createTopicMemory({
          userId,
          topic: aiResult.topic.toLowerCase(),
          content: aiResult.content,
          questions: aiResult.questions,
        })
      : await Topic.create({
          userId,
          topic: aiResult.topic.toLowerCase(),
          content: aiResult.content,
          questions: aiResult.questions,
        });

    // record token usage per user when AI call succeeds (Mongo only)
    if (!useMemoryDb()) {
      const usage = aiResult?.usage || {};
      await TokenUsage.create({
        userId,
        topicId: newTopic._id,
        provider: source,
        model: aiResult?.model || "",
        promptTokens: usage.promptTokens || 0,
        completionTokens: usage.completionTokens || 0,
        totalTokens: usage.totalTokens || 0,
        status: "success",
      });
    }

    const payload = asObject(newTopic);
    return res.status(200).json({ ...payload, source, flagged: false });
  } catch (err) {
    if (err instanceof AIProviderUnavailableError) {
      console.error("AI provider unavailable", {
        reason: err.diagnostics?.reason,
        status: err.diagnostics?.status,
        code: err.diagnostics?.code,
      });
      return res.status(503).json({
        message: err.message || "AI provider is temporarily unavailable",
      });
    }
    if (err instanceof SyntaxError) {
      return res.status(503).json({ message: "AI provider returned invalid JSON response" });
    }
    if (err?.name === "MongooseError" || err?.name === "ValidationError") {
      return res.status(500).json({ message: "Failed to save generated topic" });
    }
    if (err?.message === "Topic is required") {
      return res.status(400).json({ message: "Topic is required", flagged: true });
    }

    console.error("generateTopic failed", { message: err?.message, name: err?.name });
    return res.status(500).json({ message: "Failed to generate topic" });
  }
};

// Get topic by ID
export const getTopicById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid topic id" });
    }

    const topic = useMemoryDb()
      ? await findTopicByIdForUserMemory({ id: req.params.id, userId: req.user.id })
      : await Topic.findOne({ _id: req.params.id, userId: req.user.id });
    if (!topic) return res.status(404).json({ message: "Topic not found" });
    return res.json(topic);
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch topic" });
  }
};

// Get all user topics
export const getUserTopics = async (req, res) => {
  try {
    const topics = useMemoryDb()
      ? await findTopicsByUserMemory(req.user.id)
      : await Topic.find({ userId: req.user.id }).sort({ createdAt: -1 });
    return res.json(topics);
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch topics" });
  }
};
