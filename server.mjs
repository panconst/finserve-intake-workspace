import { createReadStream, existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(__dirname, ".env"));
const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

const DATA_FIELDS = [
  "company_name",
  "contact_name",
  "contact_email",
  "contact_phone",
  "requested_amount",
  "loan_purpose",
  "annual_revenue",
  "registration_id",
  "submission_source"
];

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "record",
    "source_by_field",
    "evidence_by_field",
    "missing_fields",
    "conflicts",
    "review_reasons_by_field"
  ],
  properties: {
    record: {
      type: "object",
      additionalProperties: false,
      required: [...DATA_FIELDS, "review_flags"],
      properties: {
        company_name: { type: "string" },
        contact_name: { type: "string" },
        contact_email: { type: "string" },
        contact_phone: { type: "string" },
        requested_amount: { type: "string" },
        loan_purpose: { type: "string" },
        annual_revenue: { type: "string" },
        registration_id: { type: "string" },
        submission_source: { type: "string" },
        review_flags: {
          type: "array",
          items: { type: "string" }
        }
      }
    },
    source_by_field: {
      type: "object",
      additionalProperties: false,
      required: DATA_FIELDS,
      properties: Object.fromEntries(DATA_FIELDS.map((field) => [field, { type: "string" }]))
    },
    evidence_by_field: {
      type: "object",
      additionalProperties: false,
      required: DATA_FIELDS,
      properties: Object.fromEntries(DATA_FIELDS.map((field) => [field, { type: "string" }]))
    },
    missing_fields: {
      type: "array",
      items: { type: "string" }
    },
    conflicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "email_value", "attachment_value", "reason"],
        properties: {
          field: { type: "string" },
          email_value: { type: "string" },
          attachment_value: { type: "string" },
          reason: { type: "string" }
        }
      }
    },
    review_reasons_by_field: {
      type: "object",
      additionalProperties: false,
      required: DATA_FIELDS,
      properties: Object.fromEntries(
        DATA_FIELDS.map((field) => [
          field,
          {
            type: "array",
            items: { type: "string" }
          }
        ])
      )
    }
  }
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/api/health") {
    const provider = resolveProvider();
    sendJson(res, 200, {
      ok: true,
      mode: provider.mode,
      message: provider.message
    });
    return;
  }

  if (requestUrl.pathname === "/api/extract" && req.method === "POST") {
    await handleExtract(req, res);
    return;
  }

  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  await serveStatic(requestUrl.pathname, res);
});

async function handleExtract(req, res) {
  try {
    const intake = await readJsonBody(req);
    const normalizedIntake = {
      email_subject: sanitizeString(intake?.email_subject),
      email_body: sanitizeString(intake?.email_body),
      document_text: sanitizeString(intake?.document_text)
    };

    if (
      !normalizedIntake.email_subject &&
      !normalizedIntake.email_body &&
      !normalizedIntake.document_text
    ) {
      sendJson(res, 400, { error: "At least one intake input is required." });
      return;
    }

    let extraction;
    let mode;
    let message;

    const provider = resolveProvider();

    if (provider.type === "openrouter") {
      try {
        extraction = await extractWithOpenRouter(normalizedIntake);
        mode = "openrouter";
        message = `Extraction completed through OpenRouter (${OPENROUTER_MODEL}).`;
      } catch (error) {
        extraction = buildFallbackExtraction(normalizedIntake);
        mode = "fallback";
        message = `OpenRouter extraction failed, so local fallback was used. ${formatError(error)}`;
      }
    } else if (provider.type === "openai") {
      try {
        extraction = await extractWithOpenAI(normalizedIntake);
        mode = "openai";
        message = `Extraction completed through OpenAI (${OPENAI_MODEL}).`;
      } catch (error) {
        extraction = buildFallbackExtraction(normalizedIntake);
        mode = "fallback";
        message = `OpenAI extraction failed, so local fallback was used. ${formatError(error)}`;
      }
    } else {
      extraction = buildFallbackExtraction(normalizedIntake);
      mode = "fallback";
      message = "OPENAI_API_KEY is not set. Local extraction fallback was used.";
    }

    sendJson(res, 200, {
      ok: true,
      mode,
      message,
      extraction: normalizeExtraction(extraction)
    });
  } catch (error) {
    sendJson(res, 500, { error: formatError(error) });
  }
}

async function extractWithOpenAI(intake) {
  const requestBody = {
    model: OPENAI_MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You extract SME lending intake data for an operations workspace. Return JSON only, matching the schema exactly. Do not invent values. Mark missing fields, source conflicts, or ambiguous wording in review_reasons_by_field and review_flags. Use concise source evidence snippets."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Create a structured ApplicationRecord from the inputs below.",
              "If a value is missing, leave it blank and add the field to missing_fields.",
              "If email and document disagree, keep the best candidate in record, add a conflict item, and mark a review reason.",
              "If the source wording is approximate or unclear, add a review reason.",
              "",
              `Email subject:\n${intake.email_subject}`,
              "",
              `Email body:\n${intake.email_body}`,
              "",
              `Document text:\n${intake.document_text}`
            ].join("\n")
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "finserve_intake_extraction",
        strict: true,
        schema: EXTRACTION_SCHEMA
      }
    }
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const outputText = extractOutputText(data);
  if (!outputText) {
    throw new Error("No structured extraction output was returned.");
  }

  return JSON.parse(outputText);
}

async function extractWithOpenRouter(intake) {
  const requestBody = {
    model: OPENROUTER_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You extract SME lending intake data for an operations workspace. Return JSON only, matching the schema exactly. Do not invent values. Mark missing fields, source conflicts, or ambiguous wording in review_reasons_by_field and review_flags. Use concise source evidence snippets."
      },
      {
        role: "user",
        content: [
          "Create a structured ApplicationRecord from the inputs below.",
          "If a value is missing, leave it blank and add the field to missing_fields.",
          "If email and document disagree, keep the best candidate in record, add a conflict item, and mark a review reason.",
          "If the source wording is approximate or unclear, add a review reason.",
          "",
          `Email subject:\n${intake.email_subject}`,
          "",
          `Email body:\n${intake.email_body}`,
          "",
          `Document text:\n${intake.document_text}`
        ].join("\n")
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "finserve_intake_extraction",
        strict: true,
        schema: EXTRACTION_SCHEMA
      }
    }
  };

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "http://127.0.0.1",
      "X-Title": "FinServe Intake Workspace"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const outputText = extractOpenRouterOutputText(data);
  if (!outputText) {
    throw new Error("No structured extraction output was returned.");
  }

  return JSON.parse(outputText);
}

function buildFallbackExtraction(intake) {
  const email = buildSourceMap(intake.email_body);
  const document = buildSourceMap(intake.document_text);
  const record = createBlankRecord();
  const sourceByField = {};
  const evidenceByField = {};
  const reviewReasonsByField = Object.fromEntries(DATA_FIELDS.map((field) => [field, []]));
  const missingFields = [];
  const conflicts = [];

  DATA_FIELDS.forEach((field) => {
    const emailCandidate = email[field];
    const documentCandidate = document[field];
    let chosen = emailCandidate || documentCandidate || null;
    let source = "not identified";

    if (emailCandidate && documentCandidate) {
      if (sameValue(emailCandidate.value, documentCandidate.value)) {
        chosen = documentCandidate.value.length > emailCandidate.value.length ? documentCandidate : emailCandidate;
        source = "email + document";
      } else {
        chosen = emailCandidate;
        source = "conflict";
        conflicts.push({
          field,
          email_value: emailCandidate.value,
          attachment_value: documentCandidate.value,
          reason: `${humanizeField(field)} differs across sources`
        });
        reviewReasonsByField[field].push("Source conflict");
      }
    } else if (emailCandidate) {
      source = "email";
    } else if (documentCandidate) {
      source = "document";
    }

    record[field] = chosen ? chosen.value : "";
    sourceByField[field] = source;
    evidenceByField[field] = chosen ? chosen.evidence : "No source evidence found";

    if (!record[field]) {
      missingFields.push(field);
      reviewReasonsByField[field].push("Missing value");
    }

    if ((emailCandidate && emailCandidate.ambiguous) || (documentCandidate && documentCandidate.ambiguous)) {
      reviewReasonsByField[field].push("Ambiguous wording");
    }
  });

  record.review_flags = DATA_FIELDS.flatMap((field) =>
    reviewReasonsByField[field].map((reason) => `${humanizeField(field)}: ${reason}`)
  );

  return {
    record,
    source_by_field: sourceByField,
    evidence_by_field: evidenceByField,
    missing_fields: missingFields,
    conflicts,
    review_reasons_by_field: reviewReasonsByField
  };
}

function buildSourceMap(text) {
  const normalized = sanitizeString(text);
  return {
    company_name: findNamedField(normalized, [
      "company",
      "applicant",
      "client legal name",
      "client"
    ]),
    contact_name: findNamedField(normalized, ["primary contact", "contact"]),
    contact_email: findPatternField(normalized, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i),
    contact_phone: findPatternField(normalized, /(\+?\d[\d\s()-]{6,}\d)/),
    requested_amount: findNamedField(normalized, [
      "requested facility",
      "requested amount",
      "amount"
    ]),
    loan_purpose: findNamedField(normalized, ["purpose of financing", "purpose"]),
    annual_revenue: findNamedField(normalized, [
      "annual revenue",
      "annual turnover",
      "reported annual revenue"
    ]),
    registration_id: findRegistrationField(normalized),
    submission_source: findNamedField(normalized, ["submission source", "source"])
  };
}

function findNamedField(text, labels) {
  const lines = splitLines(text);
  for (const line of lines) {
    for (const label of labels) {
      const pattern = new RegExp(`^${escapeRegex(label)}\\s*:\\s*(.+)$`, "i");
      const match = line.match(pattern);
      if (match) {
        const value = match[1].trim();
        return {
          value,
          evidence: line,
          ambiguous: isAmbiguousText(line)
        };
      }
    }
  }
  return null;
}

function findPatternField(text, regex) {
  const lines = splitLines(text);
  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      return {
        value: match[1].trim(),
        evidence: line,
        ambiguous: isAmbiguousText(line)
      };
    }
  }
  return null;
}

function findRegistrationField(text) {
  const lines = splitLines(text);
  for (const line of lines) {
    const labelMatch = line.match(/^(registration number|registration id)\s*:\s*(.+)$/i);
    if (labelMatch) {
      return {
        value: labelMatch[2].trim(),
        evidence: line,
        ambiguous: isAmbiguousText(line)
      };
    }
    const krsMatch = line.match(/\b(KRS\s*\d{4,})\b/i);
    if (krsMatch) {
      return {
        value: krsMatch[1].replace(/\s+/g, " ").trim(),
        evidence: line,
        ambiguous: isAmbiguousText(line)
      };
    }
  }
  return null;
}

function normalizeExtraction(extraction) {
  const normalized = createBlankExtraction();
  normalized.record.review_flags = Array.isArray(extraction?.record?.review_flags)
    ? extraction.record.review_flags.map((item) => String(item))
    : [];
  normalized.missing_fields = Array.isArray(extraction?.missing_fields) ? extraction.missing_fields : [];
  normalized.conflicts = Array.isArray(extraction?.conflicts) ? extraction.conflicts : [];

  DATA_FIELDS.forEach((field) => {
    normalized.record[field] = sanitizeString(extraction?.record?.[field]);
    normalized.source_by_field[field] = sanitizeString(extraction?.source_by_field?.[field]) || "not identified";
    normalized.evidence_by_field[field] =
      sanitizeString(extraction?.evidence_by_field?.[field]) || "No source evidence returned";
    normalized.review_reasons_by_field[field] = Array.isArray(
      extraction?.review_reasons_by_field?.[field]
    )
      ? dedupeStrings(extraction.review_reasons_by_field[field])
      : [];
  });

  return normalized;
}

function createBlankExtraction() {
  return {
    record: createBlankRecord(),
    source_by_field: Object.fromEntries(DATA_FIELDS.map((field) => [field, "not identified"])),
    evidence_by_field: Object.fromEntries(DATA_FIELDS.map((field) => [field, "No source evidence returned"])),
    missing_fields: [],
    conflicts: [],
    review_reasons_by_field: Object.fromEntries(DATA_FIELDS.map((field) => [field, []]))
  };
}

function createBlankRecord() {
  return {
    company_name: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    requested_amount: "",
    loan_purpose: "",
    annual_revenue: "",
    registration_id: "",
    submission_source: "",
    review_flags: []
  };
}

async function serveStatic(requestPath, res) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.join(__dirname, normalizedPath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const fileStat = await stat(filePath);
  if (fileStat.isDirectory()) {
    res.writeHead(403);
    res.end("Directory listing is disabled");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
  });
  createReadStream(filePath).pipe(res);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large."));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON body. ${formatError(error)}`));
      }
    });
    req.on("error", reject);
  });
}

function splitLines(text) {
  return sanitizeString(text)
    .split(/\r?\n|\\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isAmbiguousText(text) {
  return /(approx|about|around|roughly|estimate|estimated|unreadable|unclear|~)/i.test(text);
}

function sameValue(a, b) {
  return normalizeForComparison(a) === normalizeForComparison(b);
}

function normalizeForComparison(value) {
  return sanitizeString(value).replace(/\s+/g, "").toLowerCase();
}

function dedupeStrings(values) {
  return Array.from(new Set(values.map((item) => String(item))));
}

function extractOutputText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  const outputs = Array.isArray(data.output) ? data.output : [];
  outputs.forEach((item) => {
    const content = Array.isArray(item.content) ? item.content : [];
    content.forEach((contentItem) => {
      if (typeof contentItem.text === "string") {
        chunks.push(contentItem.text);
      } else if (contentItem.type === "output_text" && typeof contentItem.text === "string") {
        chunks.push(contentItem.text);
      }
    });
  });

  return chunks.join("").trim();
}

function extractOpenRouterOutputText(data) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const content = choice?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item?.text === "string" ? item.text : ""))
      .join("")
      .trim();
  }
  return "";
}

function resolveProvider() {
  if (OPENROUTER_API_KEY) {
    return {
      type: "openrouter",
      mode: "openrouter",
      message: `OpenRouter extraction is configured with model ${OPENROUTER_MODEL}.`
    };
  }

  if (OPENAI_API_KEY) {
    return {
      type: "openai",
      mode: "openai",
      message: `OpenAI extraction is configured with model ${OPENAI_MODEL}.`
    };
  }

  return {
    type: "fallback",
    mode: "fallback",
    message: "No provider key is set. Local extraction fallback is active."
  };
}

function humanizeField(field) {
  return field.replaceAll("_", " ");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  });
}

server.listen(PORT, () => {
  console.log(`FinServe Intake Workspace available at http://127.0.0.1:${PORT}`);
});
