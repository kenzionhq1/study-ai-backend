import mongoose from "mongoose";

const tokenUsageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    topicId: { type: mongoose.Schema.Types.ObjectId, ref: "Topic" },
    provider: { type: String, default: "" },
    model: { type: String, default: "" },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    status: { type: String, enum: ["success", "error"], default: "success" },
  },
  { timestamps: true }
);

export default mongoose.model("TokenUsage", tokenUsageSchema);
