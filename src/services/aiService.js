import OpenAI from "openai";

let openaiClient = null;
let groqClient = null;

export class AIProviderUnavailableError extends Error {
  constructor(message, diagnostics = {}) {
    super(message);
    this.name = "AIProviderUnavailableError";
    this.diagnostics = diagnostics;
  }
}

const LOCAL_PROVIDER = "local";
const OPENAI_PROVIDER = "openai";
const GROQ_PROVIDER = "groq";
const DEFAULT_OPENAI_MODELS = ["gpt-4o-mini", "gpt-4.1-mini"];
const DEFAULT_GROQ_MODELS = ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"];
const DEFAULT_GROQ_GUARD_MODELS = [
  "meta-llama/llama-prompt-guard-2-22m",
  "meta-llama/llama-prompt-guard-2-86m",
  "meta-llama/llama-guard-4-12b",
  "openai/gpt-oss-safeguard-20b",
];
const getMaxTopicTokens = () => {
  const raw = Number(process.env.MAX_TOPIC_TOKENS);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw;
};

const getProvider = () => (process.env.AI_PROVIDER || LOCAL_PROVIDER).toLowerCase();
const getOpenAIModels = () =>
  (process.env.OPENAI_MODELS || DEFAULT_OPENAI_MODELS.join(","))
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
const getGroqModels = () =>
  (process.env.GROQ_MODELS || DEFAULT_GROQ_MODELS.join(","))
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
const getGroqGuardModels = () => {
  const raw =
    process.env.GROQ_GUARD_MODELS || process.env.GROQ_GUARD_MODEL || "";
  const list = raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length ? list : DEFAULT_GROQ_GUARD_MODELS;
};
const useGroqGuard = () =>
  process.env.USE_GROQ_GUARD === "true" && getProvider() === GROQ_PROVIDER;
const SCIENCE_DIAGRAM_KEYWORDS = [
  "biology",
  "chemistry",
  "physics",
  "science",
  "cell",
  "atom",
  "molecule",
  "photosynthesis",
  "respiration",
  "ecosystem",
  "electric",
  "current",
  "circuit",
  "voltage",
  "magnet",
  "thermo",
  "enzyme",
  "osmosis",
  "mitosis",
  "dna",
  "rna",
  "algorithm",
  "flow",
  "process",
  "pipeline",
];

const buildFallbackMermaid = (topic) =>
  `flowchart TD
  A[${topic}] --> B[Core Mechanism]
  B --> C[Key Transformation]
  C --> D[Observable Result]
  D --> E[Real-World Impact]`;

const toMermaidImageUrl = (mermaid) => {
  const encoded = Buffer.from(mermaid, "utf8").toString("base64");
  return `https://mermaid.ink/img/${encoded}`;
};

const shouldIncludeDiagram = (normalizedTopic) => {
  const lowered = normalizedTopic.toLowerCase();
  return SCIENCE_DIAGRAM_KEYWORDS.some((keyword) => lowered.includes(keyword));
};

const buildLocalTopic = (normalizedTopic, includeDiagram = false) => {
  const payload = {
    topic: normalizedTopic,
    content: {
      definition: `${normalizedTopic} is an important study topic.`,
      explanation:
        "This content was generated locally by the backend provider.",
      keyPoints: [
        `Understand the core concepts of ${normalizedTopic}.`,
        "Break the topic into definitions, examples, and edge cases.",
        "Practice active recall with short questions.",
      ],
      example: {
        title: `${normalizedTopic} Example`,
        content: `A simple worked example for ${normalizedTopic}.`,
      },
      examTips: [
        "Start with definitions before deeper explanations.",
        "Practice likely MCQ and short-answer patterns.",
      ],
    },
    questions: [
      {
        question: `Which statement best describes ${normalizedTopic}?`,
        options: ["Core concept", "Unrelated concept", "Random fact", "None of the above"],
        answer: "Core concept",
      },
    ],
    source: LOCAL_PROVIDER,
  };

  if (includeDiagram) {
    const mermaid = buildFallbackMermaid(normalizedTopic);
    payload.content.diagram = {
      title: `${normalizedTopic} Diagram`,
      type: "mermaid",
      mermaid,
      caption: "Visual process overview",
      imageUrl: toMermaidImageUrl(mermaid),
    };
  }

  return payload;
};

function getOpenAIClient() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new AIProviderUnavailableError("AI provider is unavailable", {
        reason: "missing_openai_key",
      });
    }

    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: Number(process.env.OPENAI_TIMEOUT_MS || 30000),
      maxRetries: 1,
    });
  }
  return openaiClient;
}

function getGroqClient() {
  if (!groqClient) {
    if (!process.env.GROQ_API_KEY) {
      throw new AIProviderUnavailableError("AI provider is unavailable", {
        reason: "missing_groq_key",
      });
    }

    groqClient = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
      timeout: Number(process.env.GROQ_TIMEOUT_MS || 30000),
      maxRetries: 1,
    });
  }
  return groqClient;
}

const mapProviderError = (provider, err) => {
  const message = String(err?.message || "").toLowerCase();
  const status = err?.status;
  const code = err?.code;
  const providerName = provider === GROQ_PROVIDER ? "Groq" : "AI";

  if (status === 401 || message.includes("incorrect api key") || code === "invalid_api_key") {
    return {
      message: `${providerName} rejected credentials`,
      diagnostics: { reason: "invalid_provider_key", status, code },
    };
  }
  if (
    status === 429 ||
    message.includes("rate limit") ||
    message.includes("quota") ||
    code === "insufficient_quota"
  ) {
    return {
      message: `${providerName} is currently rate-limited`,
      diagnostics: { reason: "rate_limited", status, code },
    };
  }
  if (status === 400 && code === "json_validate_failed") {
    return {
      message: `${providerName} JSON format validation failed`,
      diagnostics: { reason: "json_validate_failed", status, code },
    };
  }
  if (status >= 500 || message.includes("timeout") || message.includes("fetch failed")) {
    return {
      message: "AI provider is temporarily unavailable",
      diagnostics: { reason: "provider_unavailable", status, code },
    };
  }
  if (
    message.includes("connection error") ||
    message.includes("network") ||
    message.includes("econn") ||
    message.includes("enotfound")
  ) {
    return {
      message: "AI provider connection failed",
      diagnostics: { reason: "provider_connection_error", status, code },
    };
  }
  return {
    message: "AI provider request failed",
    diagnostics: {
      reason: "unknown_provider_error",
      status,
      code,
      rawMessage: String(err?.message || ""),
      type: err?.type,
    },
  };
};

const parseJsonSafe = (text, fallback = {}) => {
  try {
    if (!text) return fallback;
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```json\\s*([\\s\\S]*?)```/i) || text.match(/```([\\s\\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return fallback;
      }
    }
  }
  return fallback;
};

const extractTextFromResponse = (response) => {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const parts = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string" && content.text.trim()) {
        parts.push(content.text.trim());
      }
    }
  }
  return parts.join("\n").trim();
};

const extractTextFromChatCompletion = (response) =>
  response?.choices?.[0]?.message?.content?.trim?.() || "";

const normalizeUsage = (usage = {}) => {
  const prompt =
    usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.inputTokens ?? 0;
  const completion =
    usage.completion_tokens ??
    usage.output_tokens ??
    usage.completionTokens ??
    usage.outputTokens ??
    0;
  const total = usage.total_tokens ?? usage.totalTokens ?? prompt + completion;
  return {
    promptTokens: Number(prompt) || 0,
    completionTokens: Number(completion) || 0,
    totalTokens: Number(total) || 0,
  };
};

const parseTopicJson = (text) => {
  if (!text) throw new SyntaxError("Empty AI text response");

  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```([\s\S]*?)```/i);
    if (fenced?.[1]) return JSON.parse(fenced[1].trim());

    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(text.slice(first, last + 1));
    }

    throw new SyntaxError("Could not parse AI JSON response");
  }
};

const normalizeStructuredTopic = (raw, normalizedTopic) => {
  const safeTopic = String(raw?.topic || normalizedTopic).trim() || normalizedTopic;
  const sectionsRaw = Array.isArray(raw?.sections) ? raw.sections : [];
  const sections = sectionsRaw
    .map((section, idx) => {
      const type = String(section?.type || "text").trim();
      return {
        type,
        heading: String(section?.heading || `Section ${idx + 1}`).trim(),
        content: String(section?.content || "").trim(),
        items: Array.isArray(section?.items) ? section.items.map((v) => String(v || "").trim()).filter(Boolean) : [],
        steps: Array.isArray(section?.steps) ? section.steps.map((v) => String(v || "").trim()).filter(Boolean) : [],
        questions: Array.isArray(section?.questions)
          ? section.questions.map((q) => ({
              question: String(q?.question || "").trim(),
              answer: String(q?.answer || "").trim(),
              options: Array.isArray(q?.options)
                ? q.options.map((o) => String(o || "").trim()).filter(Boolean).slice(0, 4)
                : [],
            }))
          : [],
      };
    })
    .filter((s) => s.content || s.items.length || s.steps.length || s.questions.length);

  if (!sections.length) {
    sections.push({
      type: "text",
      heading: safeTopic,
      content: "No structured content was returned.",
      items: [],
      steps: [],
      questions: [],
    });
  }

  return {
    topic: safeTopic,
    content: {
      title: String(raw?.title || safeTopic).trim() || safeTopic,
      sections,
    },
    questions: [], // preserved field for compatibility; sections may contain questions
  };
};

const analyzeUserIntent = async (topic) => {
  const defaultMeta = {
    intent: "explain",
    best_format: "breakdown",
    difficulty: "intermediate",
    tone: "detailed",
  };

  const provider = getProvider();
  if (provider === LOCAL_PROVIDER) return defaultMeta;

  const models =
    provider === GROQ_PROVIDER ? getGroqModels() : getOpenAIModels();
  const model = models[0];
  const client = provider === GROQ_PROVIDER ? getGroqClient() : getOpenAIClient();
  const prompt = `
Analyze the user's topic and decide the best way to answer.
Return STRICT JSON only with keys: intent (explain|solve|summarize|compare|analyze), best_format (step-by-step|narrative|breakdown|bullets|qa|mixed), difficulty (beginner|intermediate|advanced), tone (simple|detailed|exam-focused).
Topic: "${topic}"
JSON only. No prose.`;

  try {
    const response =
      provider === GROQ_PROVIDER
        ? await client.chat.completions.create({
            model,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: "You return only valid JSON." },
              { role: "user", content: prompt },
            ],
          })
        : await client.chat.completions.create({
            model,
            temperature: 0,
            messages: [
              { role: "system", content: "You return only valid JSON." },
              { role: "user", content: prompt },
            ],
          });

    const text = extractTextFromChatCompletion(response);
    const parsed = parseJsonSafe(text, defaultMeta);
    return {
      intent: parsed.intent || defaultMeta.intent,
      best_format: parsed.best_format || defaultMeta.best_format,
      difficulty: parsed.difficulty || defaultMeta.difficulty,
      tone: parsed.tone || defaultMeta.tone,
    };
  } catch (err) {
    console.warn("analyzeUserIntent failed; using defaults", { message: err?.message });
    return defaultMeta;
  }
};

const buildDynamicPrompt = (topic, meta) => {
  const formatHint = meta?.best_format || "mixed";
  const difficulty = meta?.difficulty || "intermediate";
  const tone = meta?.tone || "detailed";

  return `You are an adaptive tutor. Topic: "${topic}".
Intent: ${meta?.intent || "explain"}
Best format: ${formatHint}
Difficulty: ${difficulty}
Tone: ${tone}

Produce a structured, concise, and readable explanation tailored to the intent and format above.

Return STRICT JSON in this shape:
{
  "title": "<short title>",
  "sections": [
    {
      "type": "text | list | steps | qa",
      "heading": "<section heading>",
      "content": "<plain text>",
      "items": ["bullet item 1", "bullet item 2"],
      "steps": ["step 1", "step 2"],
      "questions": [
        { "question": "<short question>", "answer": "<short answer>", "options": ["A","B"] }
      ]
    }
  ]
}

Rules:
- Only include fields that fit the chosen format; leave arrays empty when not needed.
- Keep it focused and non-repetitive.
- No markdown fences, no prose outside JSON.`;
};

export const moderateTopicWithAI = async (topic) => {
  const normalizedTopic = String(topic || "").trim();
  if (!normalizedTopic) {
    return {
      checked: true,
      flagged: true,
      code: "EMPTY_TOPIC",
      reason: "empty_topic",
      message: "Topic is required",
    };
  }

  if (!useGroqGuard()) {
    return { checked: false, flagged: false };
  }

  const guardModels = getGroqGuardModels();
  const client = getGroqClient();
  let lastErr = null;

  for (const guardModel of guardModels) {
    try {
      const prompt = `
Classify whether this topic is safe and appropriate for an educational study app.
Topic: "${normalizedTopic}"

Block if topic is sexual/pornographic, hateful/abusive, violent wrongdoing, or clearly not educational.
Allow normal educational topics.

Return JSON only:
{
  "allowed": true,
  "reason": "short_reason",
  "message": "short_user_message"
}`;

      const response = await client.chat.completions.create({
        model: guardModel,
        temperature: 0,
        max_tokens: 120,
        messages: [
          { role: "system", content: "You are a strict safety classifier." },
          { role: "user", content: prompt },
        ],
      });

      const text = extractTextFromChatCompletion(response);
      let allowed = true;
      let parsedReason = "allowed";
      let parsedMessage = "";
      try {
        const parsed = parseTopicJson(text);
        allowed = Boolean(parsed?.allowed);
        parsedReason = String(parsed?.reason || parsedReason);
        parsedMessage = String(parsed?.message || parsedMessage);
      } catch {
        const lowered = text.toLowerCase();
        if (
          lowered.includes("disallow") ||
          lowered.includes("not allowed") ||
          lowered.includes("unsafe")
        ) {
          allowed = false;
          parsedReason = "blocked_by_ai_guard";
        }
      }

      if (!allowed) {
        return {
          checked: true,
          flagged: true,
          code: "INAPPROPRIATE_TOPIC",
          reason: parsedReason,
          message:
            parsedMessage.trim() ||
            "This topic is not allowed. Please enter an academic study topic.",
        };
      }

      return { checked: true, flagged: false, model: guardModel };
    } catch (err) {
      const mapped = mapProviderError(GROQ_PROVIDER, err);
      const modelMissing =
        mapped.diagnostics?.status === 404 ||
        mapped.diagnostics?.code === "model_not_found" ||
        mapped.diagnostics?.reason === "model_not_found";

      lastErr = mapped;
      // try next guard model when this one is missing
      if (modelMissing) {
        continue;
      }

      console.warn("Groq guard moderation failed", {
        reason: mapped.diagnostics?.reason,
        status: mapped.diagnostics?.status,
        code: mapped.diagnostics?.code,
      });
      // fail-open for transient errors
      return { checked: false, flagged: false };
    }
  }

  if (lastErr) {
    console.warn("Groq guard moderation failed for all models", {
      reason: lastErr.diagnostics?.reason,
      status: lastErr.diagnostics?.status,
      code: lastErr.diagnostics?.code,
    });
  }
  // fail-open if no guard model worked
  return { checked: false, flagged: false };
};

export const generateTopicWithAI = async (topic) => {
  const normalizedTopic = String(topic).trim();

  if (!normalizedTopic) {
    throw new Error("Topic is required");
  }

  const provider = getProvider();
  const includeDiagram = shouldIncludeDiagram(normalizedTopic);

  if (provider === LOCAL_PROVIDER) {
    const localContent = buildLocalTopic(normalizedTopic, includeDiagram);
    return {
      topic: localContent.topic,
      content: {
        title: localContent.topic,
        sections: [
          {
            type: "text",
            heading: localContent.topic,
            content: localContent.content?.explanation || "Local provider response.",
            items: localContent.content?.keyPoints || [],
            steps: [],
            questions: [],
          },
        ],
      },
      questions: [],
      source: LOCAL_PROVIDER,
      model: "local",
      meta,
    };
  }

  if (![OPENAI_PROVIDER, GROQ_PROVIDER].includes(provider)) {
    throw new Error(`Unsupported AI_PROVIDER "${provider}"`);
  }

  if (process.env.SIMULATE_AI_DOWN === "true") {
    throw new AIProviderUnavailableError("AI provider is temporarily unavailable", {
      reason: "simulated_unavailable",
    });
  }

  const meta = await analyzeUserIntent(normalizedTopic);
  const prompt = buildDynamicPrompt(normalizedTopic, meta);
  const models = provider === GROQ_PROVIDER ? getGroqModels() : getOpenAIModels();
  const client = provider === GROQ_PROVIDER ? getGroqClient() : getOpenAIClient();
  const maxTopicTokens = getMaxTopicTokens();
  let lastErr = null;

  for (const model of models) {
    try {
      const requestPayload = {
        model,
        temperature: Number(process.env.AI_TEMPERATURE || 0.35),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You generate concise, structured JSON answers." },
          { role: "user", content: prompt },
        ],
      };
      if (maxTopicTokens) requestPayload.max_tokens = maxTopicTokens;

      const response = await client.chat.completions.create(requestPayload);
      const text = extractTextFromChatCompletion(response);
      const parsed = parseJsonSafe(text, {});

      if (!parsed?.sections || !Array.isArray(parsed.sections) || !parsed.sections.length) {
        parsed.sections = [
          {
            type: "text",
            heading: normalizedTopic,
            content: text || "No content returned",
            items: [],
            steps: [],
            questions: [],
          },
        ];
      }

      const normalized = normalizeStructuredTopic(parsed, normalizedTopic);
      const usage = normalizeUsage(response?.usage);

      return {
        ...normalized,
        source: provider,
        model,
        usage,
        meta,
      };
    } catch (err) {
      const mapped = mapProviderError(provider, err);
      const modelMissing =
        mapped.diagnostics?.status === 404 ||
        mapped.diagnostics?.code === "model_not_found" ||
        String(mapped.diagnostics?.rawMessage || "").toLowerCase().includes("model");

      // Try next model when this one is unavailable.
      if (modelMissing) {
        lastErr = new AIProviderUnavailableError("Requested AI model is unavailable", {
          ...mapped.diagnostics,
          model,
        });
        continue;
      }

      throw new AIProviderUnavailableError(mapped.message, {
        ...mapped.diagnostics,
        model,
      });
    }
  }

  throw (
    lastErr ||
    new AIProviderUnavailableError("AI provider is temporarily unavailable", {
      reason: "no_working_model",
    })
  );
};
