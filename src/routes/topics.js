import express from "express";
import { generateTopic, getTopicById, getUserTopics } from "../controllers/topicController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

router.post("/generate", protect, generateTopic);
router.post("/", protect, generateTopic);
router.get("/:id", protect, getTopicById);
router.get("/", protect, getUserTopics);

export default router;
