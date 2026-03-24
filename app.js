const DATA_FIELDS = [
  { key: "company_name", label: "Company name" },
  { key: "contact_name", label: "Contact name" },
  { key: "contact_email", label: "Contact email" },
  { key: "contact_phone", label: "Contact phone" },
  { key: "requested_amount", label: "Requested amount" },
  { key: "loan_purpose", label: "Loan purpose" },
  { key: "annual_revenue", label: "Annual revenue" },
  { key: "registration_id", label: "Registration ID" },
  { key: "submission_source", label: "Submission source" }
];

const SAMPLE_FIXTURES = {
  clean: {
    email_subject: "SME loan application - Baltic Components sp. z o.o.",
    email_body: `Hello FinServe team,

Please find our loan application attached for review.

Company: Baltic Components sp. z o.o.
Primary contact: Anna Zielinska
Email: anna.zielinska@balticcomponents.pl
Phone: +48 501 224 991
Requested facility: PLN 350,000
Purpose: purchase of CNC equipment and working capital buffer
Submission source: website

Best regards,
Anna Zielinska`,
    document_text: `Applicant: Baltic Components sp. z o.o.
Registration number: KRS 0000912456
Annual revenue (FY2025): PLN 2,450,000
Requested amount: PLN 350,000
Purpose of financing: CNC equipment purchase and working capital support`
  },
  missing: {
    email_subject: "Application for seasonal inventory line - Green Basket Foods",
    email_body: `Hi,

We would like to apply for a short-term financing facility for increased seasonal inventory.

Company: Green Basket Foods sp. z o.o.
Contact: Piotr Lewandowski
Email: piotr.lewandowski@greenbasket.pl
Requested amount: PLN 180,000
Purpose: seasonal inventory financing
Submission source: broker

Regards,
Piotr`,
    document_text: `Client legal name: Green Basket Foods sp. z o.o.
Annual turnover: approx. PLN 1.6m
Registration ID: KRS 0000788823
Requested facility: PLN 180,000
Note: contact phone unreadable in scanned form`
  },
  conflict: {
    email_subject: "Bridge financing request - Northshore Logistics",
    email_body: `Dear FinServe,

Please review our request for expansion financing.

Company: Northshore Logistics sp. z o.o.
Contact: Marta Nowak
Email: m.nowak@northshorelogistics.pl
Phone: +48 602 901 447
Requested amount: PLN 420,000
Purpose: fleet expansion and warehouse tooling
Submission source: partner channel

Regards,
Marta Nowak`,
    document_text: `Applicant: Northshore Logistics sp. z o.o.
Registration number: KRS 0000664408
Annual revenue FY2025: PLN 4,200,000
Requested amount in signed form: PLN 400,000
Purpose of financing: fleet expansion and warehouse tooling`
  }
};

const dom = {
  serviceBadge: document.getElementById("serviceBadge"),
  serviceNote: document.getElementById("serviceNote"),
  subjectInput: document.getElementById("subjectInput"),
  emailInput: document.getElementById("emailInput"),
  documentInput: document.getElementById("documentInput"),
  extractButton: document.getElementById("extractButton"),
  clearButton: document.getElementById("clearButton"),
  statusBar: document.getElementById("statusBar"),
  reviewTableBody: document.getElementById("reviewTableBody"),
  reviewSummary: document.getElementById("reviewSummary"),
  confirmCleanButton: document.getElementById("confirmCleanButton"),
  approveButton: document.getElementById("approveButton"),
  approvedBadge: document.getElementById("approvedBadge"),
  approvedRecord: document.getElementById("approvedRecord"),
  crmCard: document.getElementById("crmCard"),
  memoDraft: document.getElementById("memoDraft"),
  payloadPreview: document.getElementById("payloadPreview"),
  activityLog: document.getElementById("activityLog")
};

const state = {
  extraction: null,
  reviewRows: [],
  approvedRecord: null,
  activity: [],
  serviceMode: "checking",
  serviceMessage: ""
};

function init() {
  bindEvents();
  hydrateHiddenSample();
  refreshServiceState();
  renderAll();
}

function bindEvents() {
  dom.extractButton.addEventListener("click", runExtraction);
  dom.clearButton.addEventListener("click", clearWorkspace);
  dom.confirmCleanButton.addEventListener("click", confirmAutoFilledRows);
  dom.approveButton.addEventListener("click", approveRecord);
}

async function refreshServiceState() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error(`Health check failed with ${response.status}`);
    const data = await response.json();
    state.serviceMode = data.mode || "ready";
    state.serviceMessage = data.message || "Extraction service ready.";
  } catch (error) {
    state.serviceMode = "error";
    state.serviceMessage = `Extraction service unavailable. ${formatError(error)}`;
  }
  renderServiceState();
}

function hydrateHiddenSample() {
  const params = new URLSearchParams(window.location.search);
  const sampleId = params.get("sample");
  if (!sampleId || !SAMPLE_FIXTURES[sampleId]) return;

  const sample = SAMPLE_FIXTURES[sampleId];
  dom.subjectInput.value = sample.email_subject;
  dom.emailInput.value = sample.email_body;
  dom.documentInput.value = sample.document_text;
}

function renderAll() {
  renderServiceState();
  renderReviewTable();
  renderReviewSummary();
  renderApprovedRecord();
  renderDownstreamViews();
  renderActivity();
  renderStatus();
}

function renderServiceState() {
  const modeMap = {
    openai: ["badge-success", "AI connected"],
    openrouter: ["badge-success", "AI connected"],
    fallback: ["badge-warning", "Local fallback"],
    checking: ["badge-neutral", "Checking"],
    error: ["badge-danger", "Unavailable"]
  };
  const [badgeClass, label] = modeMap[state.serviceMode] || ["badge-neutral", "Ready"];
  dom.serviceBadge.className = `badge ${badgeClass}`;
  dom.serviceBadge.textContent = label;
  dom.serviceNote.textContent = state.serviceMessage;
}

function currentIntake() {
  return {
    email_subject: dom.subjectInput.value.trim(),
    email_body: dom.emailInput.value.trim(),
    document_text: dom.documentInput.value.trim()
  };
}

async function runExtraction() {
  const intake = currentIntake();
  if (!intake.email_subject && !intake.email_body && !intake.document_text) {
    renderStatus("Paste intake data before running extraction.");
    return;
  }

  setBusy(true);
  renderStatus("Extracting structured intake record...");

  try {
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(intake)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `Extraction failed with ${response.status}`);
    }

    state.serviceMode = data.mode || state.serviceMode;
    state.serviceMessage = data.message || state.serviceMessage;
    state.extraction = normalizeExtraction(data.extraction);
    state.reviewRows = buildReviewRows(state.extraction);
    state.approvedRecord = null;
    state.activity = [
      {
        title: "Extraction completed",
        copy: data.message || "Structured intake record generated."
      }
    ];
    renderAll();
  } catch (error) {
    renderStatus(`Extraction failed. ${formatError(error)}`);
  } finally {
    setBusy(false);
  }
}

function normalizeExtraction(extraction) {
  const normalized = {
    record: createBlankRecord(),
    source_by_field: {},
    evidence_by_field: {},
    missing_fields: Array.isArray(extraction?.missing_fields) ? extraction.missing_fields : [],
    conflicts: Array.isArray(extraction?.conflicts) ? extraction.conflicts : [],
    review_reasons_by_field: extraction?.review_reasons_by_field || {}
  };

  DATA_FIELDS.forEach((field) => {
    normalized.record[field.key] = sanitizeString(extraction?.record?.[field.key]);
    normalized.source_by_field[field.key] =
      sanitizeString(extraction?.source_by_field?.[field.key]) || "not identified";
    normalized.evidence_by_field[field.key] =
      sanitizeString(extraction?.evidence_by_field?.[field.key]) || "No source evidence returned.";
    normalized.review_reasons_by_field[field.key] = Array.isArray(
      extraction?.review_reasons_by_field?.[field.key]
    )
      ? extraction.review_reasons_by_field[field.key].map((item) => String(item))
      : [];
  });

  normalized.record.review_flags = Array.isArray(extraction?.record?.review_flags)
    ? extraction.record.review_flags.map((item) => String(item))
    : [];

  return normalized;
}

function buildReviewRows(extraction) {
  return DATA_FIELDS.map((field) => {
    const proposedValue = extraction.record[field.key];
    const reasons = [...extraction.review_reasons_by_field[field.key]];
    const conflict = extraction.conflicts.find((item) => item.field === field.key);

    if (extraction.missing_fields.includes(field.key) && !reasons.includes("Missing value")) {
      reasons.push("Missing value");
    }
    if (conflict && !reasons.includes("Source conflict")) {
      reasons.push("Source conflict");
    }

    return {
      key: field.key,
      label: field.label,
      proposedValue,
      currentValue: proposedValue,
      source: extraction.source_by_field[field.key],
      evidence: buildEvidence(extraction, field.key, conflict),
      reasons,
      status: reasons.length ? "needs review" : "auto-filled"
    };
  });
}

function buildEvidence(extraction, fieldKey, conflict) {
  const base = extraction.evidence_by_field[fieldKey];
  if (!conflict) return base;
  return `${base} Conflict: email="${conflict.email_value}" vs document="${conflict.attachment_value}".`;
}

function renderReviewTable() {
  if (!state.reviewRows.length) {
    dom.reviewTableBody.innerHTML =
      '<tr><td colspan="7" class="empty-state">No extracted fields yet.</td></tr>';
    return;
  }

  dom.reviewTableBody.innerHTML = state.reviewRows
    .map((row) => {
      const rowClass = row.status === "needs review" ? "review-row-warning" : "review-row-clean";
      const reasonCopy = row.reasons.length ? row.reasons.join(", ") : "No review needed";
      return `
        <tr class="${rowClass}">
          <td><strong>${escapeHtml(row.label)}</strong></td>
          <td>
            <textarea class="input review-input" data-role="review-input" data-field="${row.key}" spellcheck="false">${escapeHtml(row.currentValue)}</textarea>
          </td>
          <td><span class="badge badge-accent">${escapeHtml(row.source)}</span></td>
          <td>${renderReasonBadges(row.reasons)}</td>
          <td>${renderStatusBadge(row.status)}</td>
          <td><p class="evidence">${escapeHtml(row.evidence)}</p></td>
          <td><button class="button button-secondary" data-role="confirm-row" data-field="${row.key}" type="button">Confirm</button></td>
        </tr>
      `;
    })
    .join("");

  dom.reviewTableBody.querySelectorAll('[data-role="review-input"]').forEach((element) => {
    element.addEventListener("input", handleReviewInput);
  });
  dom.reviewTableBody.querySelectorAll('[data-role="confirm-row"]').forEach((element) => {
    element.addEventListener("click", handleConfirmRow);
  });
}

function renderReasonBadges(reasons) {
  if (!reasons.length) {
    return '<span class="badge badge-neutral">Clean</span>';
  }
  return reasons
    .map((reason) => `<span class="badge badge-warning">${escapeHtml(reason)}</span>`)
    .join("");
}

function renderReviewSummary() {
  if (!state.reviewRows.length) {
    dom.reviewSummary.innerHTML = "";
    return;
  }

  const pending = state.reviewRows.filter((row) => row.status === "needs review").length;
  const corrected = state.reviewRows.filter((row) => row.status === "corrected").length;
  const confirmed = state.reviewRows.filter((row) => row.status === "confirmed").length;
  const autoFilled = state.reviewRows.filter((row) => row.status === "auto-filled").length;

  dom.reviewSummary.innerHTML = [
    `<span class="badge ${pending ? "badge-warning" : "badge-success"}">${pending} need review</span>`,
    `<span class="badge badge-accent">${autoFilled} auto-filled</span>`,
    `<span class="badge badge-success">${confirmed} confirmed</span>`,
    `<span class="badge badge-neutral">${corrected} corrected</span>`
  ].join("");
}

function handleReviewInput(event) {
  const field = event.target.dataset.field;
  const row = state.reviewRows.find((item) => item.key === field);
  if (!row) return;

  row.currentValue = event.target.value;
  row.status = row.currentValue.trim() === row.proposedValue.trim() ? "needs review" : "corrected";
  renderReviewSummary();
  renderStatus();
}

function handleConfirmRow(event) {
  const row = state.reviewRows.find((item) => item.key === event.target.dataset.field);
  if (!row) return;

  row.currentValue = row.currentValue.trim();
  row.status = row.currentValue === row.proposedValue ? "confirmed" : "corrected";
  state.activity.unshift({
    title: `${row.label} ${row.status}`,
    copy:
      row.status === "corrected"
        ? `Updated from "${row.proposedValue || "blank"}" to "${row.currentValue || "blank"}".`
        : `Accepted proposed value "${row.currentValue || "blank"}".`
  });
  renderAll();
}

function confirmAutoFilledRows() {
  if (!state.reviewRows.length) return;

  state.reviewRows.forEach((row) => {
    if (row.status === "auto-filled") {
      row.status = "confirmed";
    }
  });

  state.activity.unshift({
    title: "Clean fields confirmed",
    copy: "All fields without review reasons were accepted."
  });
  renderAll();
}

function approveRecord() {
  if (!state.reviewRows.length) {
    renderStatus("Run extraction before approving a record.");
    return;
  }

  const unresolved = state.reviewRows.filter((row) => row.status === "needs review");
  if (unresolved.length) {
    renderStatus(
      `Resolve ${unresolved.length} field${unresolved.length === 1 ? "" : "s"} before approving the record.`
    );
    return;
  }

  const approved = createBlankRecord();
  state.reviewRows.forEach((row) => {
    approved[row.key] = row.currentValue.trim();
  });
  approved.review_flags = state.reviewRows
    .filter((row) => row.status === "corrected")
    .map((row) => `Analyst corrected ${row.label.toLowerCase()}`);

  state.approvedRecord = approved;
  state.activity.unshift({
    title: "Approved record created",
    copy: "The approved record is now reused across downstream views and the handoff payload."
  });
  renderAll();
}

function renderApprovedRecord() {
  if (!state.approvedRecord) {
    dom.approvedBadge.className = "badge badge-neutral";
    dom.approvedBadge.textContent = "Pending";
    dom.approvedRecord.innerHTML =
      '<p class="empty-state">Approved record will appear here after review is complete.</p>';
    return;
  }

  dom.approvedBadge.className = "badge badge-success";
  dom.approvedBadge.textContent = "Approved";
  dom.approvedRecord.innerHTML = [
    ...DATA_FIELDS.map((field) => ({
      label: field.label,
      value: state.approvedRecord[field.key] || "Not provided"
    })),
    {
      label: "Review notes",
      value: state.approvedRecord.review_flags.join("; ") || "No review notes"
    }
  ]
    .map(
      (item) => `
        <div class="record-item">
          <span class="record-label">${escapeHtml(item.label)}</span>
          <p class="record-value">${escapeHtml(item.value)}</p>
        </div>
      `
    )
    .join("");
}

function renderDownstreamViews() {
  if (!state.approvedRecord) {
    dom.crmCard.innerHTML = '<p class="empty-state">CRM view is generated from the approved record.</p>';
    dom.memoDraft.innerHTML =
      '<p class="empty-state">Draft memo summary is generated from the approved record.</p>';
    dom.payloadPreview.textContent = "{\n  \"handoff_payload\": \"pending\"\n}";
    return;
  }

  const record = state.approvedRecord;
  dom.crmCard.innerHTML = `
    <div class="system-header">
      <h3>CRM record</h3>
      <span class="badge badge-success">Ready</span>
    </div>
    <div class="crm-grid">
      ${renderCrmChip("Account", record.company_name)}
      ${renderCrmChip("Primary contact", record.contact_name)}
      ${renderCrmChip("Email", record.contact_email)}
      ${renderCrmChip("Phone", record.contact_phone || "Follow-up required")}
      ${renderCrmChip("Requested amount", record.requested_amount)}
      ${renderCrmChip("Submission source", record.submission_source)}
      ${renderCrmChip("Annual revenue", record.annual_revenue)}
      ${renderCrmChip("Registration ID", record.registration_id)}
    </div>
  `;

  dom.memoDraft.innerHTML = `
    <div class="system-header">
      <h3>Draft memo summary</h3>
      <span class="badge badge-accent">From approved record</span>
    </div>
    <p class="memo-block">
      <strong>Applicant:</strong> ${escapeHtml(record.company_name)}<br>
      <strong>Primary contact:</strong> ${escapeHtml(record.contact_name)} (${escapeHtml(record.contact_email)})<br>
      <strong>Requested facility:</strong> ${escapeHtml(record.requested_amount)}<br>
      <strong>Purpose:</strong> ${escapeHtml(record.loan_purpose)}<br>
      <strong>Annual revenue:</strong> ${escapeHtml(record.annual_revenue)}<br>
      <strong>Registration ID:</strong> ${escapeHtml(record.registration_id)}<br>
      <strong>Submission source:</strong> ${escapeHtml(record.submission_source)}
    </p>
  `;

  dom.payloadPreview.textContent = JSON.stringify(buildHandoffPayload(record), null, 2);
}

function buildHandoffPayload(record) {
  return {
    application_record: {
      company_name: record.company_name,
      contact_name: record.contact_name,
      contact_email: record.contact_email,
      contact_phone: record.contact_phone,
      requested_amount: record.requested_amount,
      loan_purpose: record.loan_purpose,
      annual_revenue: record.annual_revenue,
      registration_id: record.registration_id,
      submission_source: record.submission_source
    },
    workflow_state: "approved_for_handoff",
    review_notes: record.review_flags
  };
}

function renderActivity() {
  if (!state.activity.length) {
    dom.activityLog.innerHTML = '<p class="empty-state">No activity yet.</p>';
    return;
  }

  dom.activityLog.innerHTML = state.activity
    .map(
      (entry) => `
        <article class="timeline-item">
          <p class="timeline-title">${escapeHtml(entry.title)}</p>
          <p class="timeline-copy">${escapeHtml(entry.copy)}</p>
        </article>
      `
    )
    .join("");
}

function renderStatus(message) {
  if (message) {
    dom.statusBar.textContent = message;
    return;
  }

  if (!state.extraction) {
    dom.statusBar.textContent = "Paste intake data and run extraction.";
    return;
  }

  if (state.approvedRecord) {
    dom.statusBar.textContent = "Approved record is ready for downstream handoff.";
    return;
  }

  const pending = state.reviewRows.filter((row) => row.status === "needs review").length;
  if (pending) {
    dom.statusBar.textContent = `${pending} field${pending === 1 ? "" : "s"} still need analyst review.`;
  } else {
    dom.statusBar.textContent = "Review complete. Approve the record when ready.";
  }
}

function clearWorkspace() {
  dom.subjectInput.value = "";
  dom.emailInput.value = "";
  dom.documentInput.value = "";
  state.extraction = null;
  state.reviewRows = [];
  state.approvedRecord = null;
  state.activity = [];
  renderAll();
}

function renderStatusBadge(status) {
  const variants = {
    "auto-filled": ["badge-accent", "Auto-filled"],
    "needs review": ["badge-warning", "Needs review"],
    confirmed: ["badge-success", "Confirmed"],
    corrected: ["badge-neutral", "Corrected"]
  };
  const [badgeClass, label] = variants[status] || ["badge-neutral", status];
  return `<span class="badge ${badgeClass}">${label}</span>`;
}

function renderCrmChip(label, value) {
  return `
    <div class="crm-chip">
      <span class="crm-chip-label">${escapeHtml(label)}</span>
      <span class="crm-chip-value">${escapeHtml(value || "Not provided")}</span>
    </div>
  `;
}

function setBusy(isBusy) {
  dom.extractButton.disabled = isBusy;
  dom.clearButton.disabled = isBusy;
  dom.confirmCleanButton.disabled = isBusy;
  dom.approveButton.disabled = isBusy;
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

function sanitizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

init();
