const DEFAULT_BLOCKED_TERMS = [
  "fuck",
  "fucking",
  "motherfucker",
  "porn",
  "pornography",
  "xxx",
  "nude",
  "nudes",
  "onlyfans",
  "hentai",
  "rape",
  "incest",
  "bestiality",
  "child porn",
  "cp",
];

const buildBlockedTerms = () => {
  const extra = (process.env.BLOCKED_TOPIC_TERMS || "")
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_BLOCKED_TERMS, ...extra]);
};

const hasBlockedTerm = (text, blockedTerms) => {
  const lowered = text.toLowerCase();
  for (const term of blockedTerms) {
    if (lowered.includes(term)) return term;
  }
  return null;
};

export const analyzeTopicSafety = (value) => {
  const cleanedTopic = String(value || "").trim().replace(/\s+/g, " ");

  if (!cleanedTopic) {
    return {
      flagged: true,
      code: "EMPTY_TOPIC",
      reason: "empty_topic",
      message: "Topic is required",
      cleanedTopic: "",
    };
  }

  if (cleanedTopic.length > 140) {
    return {
      flagged: true,
      code: "TOPIC_TOO_LONG",
      reason: "topic_too_long",
      message: "Topic is too long. Keep it under 140 characters.",
      cleanedTopic,
    };
  }

  const blockedTerms = buildBlockedTerms();
  const match = hasBlockedTerm(cleanedTopic, blockedTerms);
  if (match) {
    return {
      flagged: true,
      code: "INAPPROPRIATE_TOPIC",
      reason: "inappropriate_topic",
      message: "This topic is not allowed. Please enter an academic study topic.",
      matchedTerm: match,
      cleanedTopic,
    };
  }

  return {
    flagged: false,
    code: null,
    reason: null,
    message: null,
    cleanedTopic,
  };
};
