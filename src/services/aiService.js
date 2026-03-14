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
const DEFAULT_GROQ_GUARD_MODEL = "meta-llama/llama-guard-4-12b";
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
const getGroqGuardModel = () =>
  (process.env.GROQ_GUARD_MODEL || DEFAULT_GROQ_GUARD_MODEL).trim();
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

const normalizeGeneratedTopic = (raw, normalizedTopic, includeDiagram = false) => {
  const topicValue = String(raw?.topic || normalizedTopic).trim() || normalizedTopic;
  const content = raw?.content || {};

  const normalizeList = (value) =>
    Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
      : [];

  const questionsRaw = Array.isArray(raw?.questions) ? raw.questions : [];
  const normalizedQuestions = questionsRaw
    .map((q) => {
      const options = Array.isArray(q?.options)
        ? q.options.map((opt) => String(opt || "").trim()).filter(Boolean).slice(0, 4)
        : [];
      if (!q?.question || options.length < 2) return null;
      return {
        question: String(q.question).trim(),
        options,
        answer: String(q.answer || options[0] || "").trim(),
      };
    })
    .filter(Boolean);

  while (normalizedQuestions.length < 5) {
    const idx = normalizedQuestions.length + 1;
    normalizedQuestions.push({
      question: `Practice question ${idx} on ${topicValue}: choose the most accurate statement.`,
      options: ["Option A", "Option B", "Option C", "Option D"],
      answer: "Option A",
    });
  }

  const normalized = {
    topic: topicValue,
    content: {
      definition: String(content.definition || "").trim(),
      explanation: String(content.explanation || "").trim(),
      keyPoints: normalizeList(content.keyPoints),
      example: {
        title: String(content.example?.title || `${topicValue} Example`).trim(),
        content: String(content.example?.content || "").trim(),
      },
      examTips: normalizeList(content.examTips),
    },
    questions: normalizedQuestions.slice(0, 5),
  };

  if (includeDiagram) {
    const diagram = content.diagram || {};
    const mermaid = String(diagram.mermaid || "").trim() || buildFallbackMermaid(topicValue);
    normalized.content.diagram = {
      title: String(diagram.title || `${topicValue} Diagram`).trim(),
      type: "mermaid",
      mermaid,
      caption: String(diagram.caption || "Visual process overview").trim(),
      imageUrl: toMermaidImageUrl(mermaid),
    };
  }

  return normalized;
};

const buildStudyPrompt = (normalizedTopic, includeDiagram = false) => {
  const diagramBlock = includeDiagram
    ? ',\n    "diagram": { "title": "", "type": "mermaid", "mermaid": "", "caption": "" }'
    : "";
  const diagramSection = includeDiagram
    ? '\n8) Diagram Output (Required for this topic)\n- Fill "content.diagram" with a valid Mermaid flowchart for the core process.\n- Keep Mermaid syntax clean and renderable.'
    : "";

  return `
You are an elite professor and textbook author.
Write like top-university lecture notes (MIT/Stanford style): precise, deep, and clear.

Topic: ${normalizedTopic}

Return strict JSON only with this exact shape:
{
  "topic": "${normalizedTopic}",
  "content": {
    "definition": "",
    "explanation": "",
    "keyPoints": [],
    "example": { "title": "", "content": "" },
    "examTips": []${diagramBlock}
  },
  "questions": [
    { "question": "", "options": ["", "", "", ""], "answer": "" }
  ]
}

Inside the JSON content, follow this structure:
1) Concept Definition
- Put a clear textbook definition in "content.definition".

2) Core Idea (Plain Understanding)
- Start "content.explanation" with intuition in simple language.

3) Key Components
- Put major components as concise items in "content.keyPoints".

4) Adaptive Explanation Style (IMPORTANT)
- First infer topic type, then choose the best style:
  a) Process/algorithm/science topics:
     - use stepwise mechanism and arrow flow.
     - Example style: Input -> Step 1 -> Step 2 -> Output
  b) History/story/social topics:
     - use narrative + chronology + cause-and-effect.
     - Use timeline style (not mechanical step arrows), e.g.:
       Pre-war tensions -> Trigger event -> Escalation -> Outcome -> Long-term impact
  c) Math/theory topics:
     - use intuition -> formal idea -> worked reasoning path -> common pitfalls.

5) Detailed Explanation
- In "content.explanation", explain why each stage/event/step happens (depending on style chosen).

6) Real-World Example
- Put this in "content.example.content".

7) Mini Diagram Using Text
- Add a concise text diagram in "content.example.content" that matches topic type.
- For history/story topics use timeline/causal map, not mechanical pipeline arrows.
${diagramSection}

Quality + length targets (approximate):
- definition: around 80 words
- explanation: 380-500 words (highest priority)
- key points total: around 150 words
- example section: around 200 words
- exam tips total: around 100 words
- 5 MCQ questions total: around 200 words

Rules:
- Return exactly 5 multiple-choice questions.
- Each question must have exactly 4 options.
- "answer" must exactly match one option text.
- Choose style that best matches the topic; do NOT force process arrows for history/story topics.
- No markdown, no code fence, JSON only.
- If output is too long, keep explanation depth first and shorten lower-priority sections.
`;
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

  try {
    const guardModel = getGroqGuardModel();
    const client = getGroqClient();
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

    return { checked: true, flagged: false };
  } catch (err) {
    const mapped = mapProviderError(GROQ_PROVIDER, err);
    console.warn("Groq guard moderation failed", {
      reason: mapped.diagnostics?.reason,
      status: mapped.diagnostics?.status,
      code: mapped.diagnostics?.code,
    });
    // Fail-open to avoid blocking legitimate education traffic when guard provider has issues.
    return { checked: false, flagged: false };
  }
};

export const generateTopicWithAI = async (topic) => {
  const normalizedTopic = String(topic).trim();

  if (!normalizedTopic) {
    throw new Error("Topic is required");
  }

  const provider = getProvider();
  const includeDiagram = shouldIncludeDiagram(normalizedTopic);

  if (provider === LOCAL_PROVIDER) {
    return buildLocalTopic(normalizedTopic, includeDiagram);
  }

  if (![OPENAI_PROVIDER, GROQ_PROVIDER].includes(provider)) {
    throw new Error(`Unsupported AI_PROVIDER "${provider}"`);
  }

  if (process.env.SIMULATE_AI_DOWN === "true") {
    throw new AIProviderUnavailableError("AI provider is temporarily unavailable", {
      reason: "simulated_unavailable",
    });
  }

  const prompt = buildStudyPrompt(normalizedTopic, includeDiagram);
  const models = provider === GROQ_PROVIDER ? getGroqModels() : getOpenAIModels();
  const client = provider === GROQ_PROVIDER ? getGroqClient() : getOpenAIClient();
  const maxTopicTokens = getMaxTopicTokens();
  let lastErr = null;

  for (const model of models) {
    try {
      let text = "";
      if (provider === GROQ_PROVIDER) {
        const requestPayload = {
          model,
          temperature: Number(process.env.AI_TEMPERATURE || 0.35),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You generate high-quality educational JSON outputs." },
            { role: "user", content: prompt },
          ],
        };
        if (maxTopicTokens) requestPayload.max_tokens = maxTopicTokens;
        const response = await client.chat.completions.create(requestPayload);
        text = extractTextFromChatCompletion(response);
        const usage = normalizeUsage(response?.usage);
        return {
          ...normalizeGeneratedTopic(text ? parseTopicJson(text) : {}, normalizedTopic, includeDiagram),
          source: provider,
          model,
          usage,
        };
      } else {
        const requestPayload = {
          model,
          input: prompt,
        };
        if (maxTopicTokens) requestPayload.max_output_tokens = maxTopicTokens;
        const response = await client.responses.create(requestPayload);
        text = extractTextFromResponse(response);
        const usage = normalizeUsage(response?.usage);
        return {
          ...normalizeGeneratedTopic(text ? parseTopicJson(text) : {}, normalizedTopic, includeDiagram),
          source: provider,
          model,
          usage,
        };
      }
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
