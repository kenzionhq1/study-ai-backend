import mongoose from "mongoose";

const topicSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    topic: {
      type: String,
      required: true,
    },

    content: {
      type: Object,
      required: true,
    },

    questions: {
      type: Array,
      default: [],
    },
  },
  { timestamps: true }
);

export default mongoose.model("Topic", topicSchema);