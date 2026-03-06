import mongoose from "mongoose";

const users = [];
const topics = [];

const now = () => new Date();
const objectId = () => new mongoose.Types.ObjectId().toString();

export const createUserMemory = async ({ name, email, password }) => {
  const user = {
    _id: objectId(),
    name,
    email,
    password,
    createdAt: now(),
    updatedAt: now(),
  };
  users.push(user);
  return user;
};

export const findUserByEmailMemory = async (email) =>
  users.find((user) => user.email === email) || null;

export const findUserByIdMemory = async (id) =>
  users.find((user) => user._id.toString() === id.toString()) || null;

export const createTopicMemory = async ({ userId, topic, content, questions }) => {
  const doc = {
    _id: objectId(),
    userId: userId.toString(),
    topic,
    content,
    questions: Array.isArray(questions) ? questions : [],
    createdAt: now(),
    updatedAt: now(),
  };
  topics.push(doc);
  return doc;
};

export const findTopicByUserAndNameMemory = async ({ userId, topic }) =>
  topics.find(
    (item) => item.userId.toString() === userId.toString() && item.topic === topic
  ) || null;

export const findTopicsByUserMemory = async (userId) =>
  topics
    .filter((item) => item.userId.toString() === userId.toString())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

export const findTopicByIdForUserMemory = async ({ id, userId }) =>
  topics.find(
    (item) =>
      item._id.toString() === id.toString() && item.userId.toString() === userId.toString()
  ) || null;
