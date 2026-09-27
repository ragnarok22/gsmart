import type { EffectiveConventions } from "../definitions";
import { resolveConventions } from "./conventions";

export type CommitMessageDiagnostic = {
  code: string;
  severity: 1 | 2;
  message: string;
  line?: number;
  source?: string;
  rule?: string;
};

export type CommitMessageValidation = {
  valid: boolean;
  diagnostics: CommitMessageDiagnostic[];
};

type Rules = Pick<
  EffectiveConventions,
  "conventions" | "sources" | "ruleMetadata"
>;
type Footer = { token: string; value: string; line: number };

/** Keep significant whitespace and content; Git/editor terminal newlines are harmless. */
export function normalizeCommitMessage(message: string): string {
  return message.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
}

const blank = (line: string) => !line.trim();
const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const breakingToken = (token: string) =>
  token === "BREAKING CHANGE" || token === "BREAKING-CHANGE";
const referenceTokens = new Set(["refs", "closes", "fixes", "resolves"]);

/** Syntax and effective repository rules only; this does not judge the diff's meaning. */
export function validateCommitMessage(
  message: string,
  effective: Rules = resolveConventions(),
): CommitMessageValidation {
  const { conventions: c, sources, ruleMetadata } = effective;
  const diagnostics: CommitMessageDiagnostic[] = [];
  const add = (code: string, detail: string, line?: number, field?: string) => {
    const metadata = field ? ruleMetadata[field] : undefined;
    diagnostics.push({
      code,
      severity: metadata?.severity ?? 2,
      message: detail,
      ...(line === undefined ? {} : { line }),
      ...(field && sources[field] ? { source: sources[field] } : {}),
      ...(metadata ? { rule: metadata.name } : {}),
    });
  };
  const result = (): CommitMessageValidation => ({
    valid: !diagnostics.some((item) => item.severity === 2),
    diagnostics,
  });
  const text = normalizeCommitMessage(message);
  if (!text.trim()) {
    add(
      "empty",
      "The commit message is empty. Write a type and description, for example: fix: handle missing input.",
      1,
    );
    return result();
  }
  if (
    Array.from(text).some((char) => {
      const code = char.charCodeAt(0);
      return (
        (code < 32 && code !== 9 && code !== 10) || (code >= 127 && code <= 159)
      );
    })
  )
    add(
      "control-character",
      "Remove control characters from the commit message.",
    );

  const lines = text.split("\n");
  let fence: string | undefined;
  // Exclude fenced examples from trailer parsing.
  const fencedLines = lines.map((line, index) => {
    if (index === 0) return false;
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    const inFence = Boolean(fence);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = undefined;
    }
    return inFence || Boolean(marker);
  });
  // Only leading prose can be a preamble; body/footer text may discuss messages.
  if (
    /^\s*(?:["'`[{]|~{3,}|\*\*|__|<[^>]+>)/.test(text) ||
    /^\s*(?:Here(?:'s| is) (?:the|your|a|an) (?:(?:suggested|generated) )?commit message\b|(?:This|The) (?:(?:suggested|generated) )?commit message (?:follows|uses|summarizes|describes)\b|Let me know if\b|Would you like me to\b|Validation checklist:)/i.test(
      text,
    )
  ) {
    add(
      "wrapper",
      "Return only the commit message; remove surrounding quotes, Markdown fences, or explanations and validation checklists before the header.",
    );
  }
  // Match the same token alphabet allowed in repository configuration, including
  // custom/Unicode types. Membership and scope requirements are separate rules.
  const header = /^([^\s():!]+)(?:\(([^\s():!]+)\))?(!)?: ([^\s].*)$/.exec(
    lines[0],
  );
  if (!header) {
    add(
      "header",
      "Use <type>[optional scope][!]: <description>, for example: feat(api): add pagination.",
      1,
    );
    return result();
  }
  const [, type, scope, breaking, subject] = header;
  if (c.types && !c.types.includes(type))
    add("type-enum", `Type must be one of: ${c.types.join(", ")}.`, 1, "types");
  if ((c.scope === "required" && !scope) || (c.scope === "forbidden" && scope))
    add("scope-presence", `Scope is ${c.scope}.`, 1, "scope");
  if (scope) {
    const components = scope.split(/[/\\,]/);
    if (components.some((component) => !component))
      add(
        "scope",
        "Scope components separated by /, \\ or , must be non-empty.",
        1,
      );
    if (
      c.scopes &&
      components.some((component) => !c.scopes!.includes(component))
    )
      add(
        "scope-enum",
        `Each scope component must be one of: ${c.scopes.join(", ")}.`,
        1,
        "scopes",
      );
  }
  if (c.headerMaxLength !== null && lines[0].length > c.headerMaxLength)
    add(
      "header-max-length",
      `Header must be at most ${c.headerMaxLength} characters (received ${lines[0].length}).`,
      1,
      "headerMaxLength",
    );
  if (c.subjectMaxLength !== null && subject.length > c.subjectMaxLength)
    add(
      "subject-max-length",
      `Description must be at most ${c.subjectMaxLength} characters (received ${subject.length}).`,
      1,
      "subjectMaxLength",
    );

  const footers: Footer[] = [];
  let bodyStart = -1;
  let footerStart = -1;
  const referenceToken = (token: string) =>
    token === c.tickets.footerToken || referenceTokens.has(token.toLowerCase());
  const recognizedFooter = (token: string) =>
    referenceToken(token) ||
    breakingToken(token) ||
    /^(?:Signed-off-by|Reviewed-by)$/i.test(token);
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    const breakingMarker =
      !fencedLines[index] &&
      /^(?:BREAKING CHANGE|BREAKING-CHANGE)(?=[: \t]|$)/.test(line);
    const breakingFooter = breakingMarker
      ? /^(BREAKING CHANGE|BREAKING-CHANGE): (.*)$/.exec(line)
      : null;
    if (breakingMarker && !breakingFooter)
      add(
        "breaking-footer-format",
        "Use BREAKING CHANGE: <description> or BREAKING-CHANGE: <description>, with a colon and space after the token.",
        index + 1,
      );
    const footer = !fencedLines[index]
      ? breakingMarker
        ? breakingFooter
        : /^([A-Za-z][A-Za-z0-9-]*)(?:: (.*)| (#.*))$/.exec(line)
      : null;
    if (
      footer &&
      (index === 1 ||
        blank(lines[index - 1]) ||
        footerStart >= 0 ||
        !c.footer.leadingBlank ||
        recognizedFooter(footer[1]))
    ) {
      if (footerStart < 0) footerStart = index;
      footers.push({
        token: footer[1],
        value: footer[2] ?? footer[3],
        line: index + 1,
      });
    } else if (footerStart >= 0) {
      footers[footers.length - 1].value += `\n${line}`;
    } else if (!blank(line) && bodyStart < 0) {
      bodyStart = index;
    }
  }
  const bodyEnd = footerStart < 0 ? lines.length : footerStart;
  const bodyLines = bodyStart < 0 ? [] : lines.slice(bodyStart, bodyEnd);
  const hasBody = bodyStart >= 0;
  if (
    (c.body.presence === "required" && !hasBody) ||
    (c.body.presence === "forbidden" && hasBody)
  )
    add(
      "body-presence",
      `A commit body is ${c.body.presence}.`,
      hasBody ? bodyStart + 1 : undefined,
      "body.presence",
    );
  const checkBlank = (start: number, required: boolean, field: string) => {
    if (start < 0) return;
    if (blank(lines[start - 1]) !== required)
      add(
        field.replaceAll(".", "-"),
        `${required ? "Add" : "Remove"} the blank line before the ${field.startsWith("body") ? "body" : "footers"}.`,
        start + 1,
        field,
      );
  };
  checkBlank(bodyStart, c.body.leadingBlank, "body.leadingBlank");
  checkBlank(footerStart, c.footer.leadingBlank, "footer.leadingBlank");
  if (c.body.maxLineLength !== null) {
    const max = c.body.maxLineLength;
    bodyLines.forEach((line, index) => {
      if (line.length > max && !/\b\w+:\/\/\S+/i.test(line))
        add(
          "body-max-line-length",
          `Body line must be at most ${max} characters (received ${line.length}).`,
          bodyStart + index + 1,
          "body.maxLineLength",
        );
    });
  }
  for (const footer of footers) {
    if (!footer.value.trim())
      add(
        "footer-empty",
        `Supply a value for ${footer.token}${breakingToken(footer.token) ? " explaining the breaking change" : ""}.`,
        footer.line,
      );
  }
  if (
    breaking &&
    c.breakingChanges.requireFooter &&
    !footers.some(
      (footer) => breakingToken(footer.token) && footer.value.trim(),
    )
  )
    add(
      "breaking-footer",
      "The ! header requires a BREAKING CHANGE: footer explaining the impact.",
      1,
      "breakingChanges.requireFooter",
    );

  // Literal configured prefixes and #123 are identifiable anywhere. Bare
  // PROJ-123 shapes need an explicit reference context; ordinary prose and
  // unrelated trailers can contain technical terms such as UTF-8 or SHA-256.
  const patterns = [
    ...(c.tickets.prefixes ?? []).map(
      (prefix) => `${escapeRegex(prefix)}[0-9]+`,
    ),
    "#[0-9]+",
  ];
  const ticketPattern = (patterns: string[]) =>
    new RegExp(
      `(?<![\\p{L}\\p{N}_/#-])(?:${patterns.join("|")})(?![\\p{L}\\p{N}_])`,
      "gu",
    );
  const ticketRegex = ticketPattern(patterns);
  const referenceTicketRegex = ticketPattern([
    ...patterns,
    "[A-Z][A-Z0-9_]*-[0-9]+",
  ]);
  const sections = [
    { placement: "subject", text: subject, line: 1, token: undefined },
    ...bodyLines.map((line, index) => ({
      placement: "body",
      text: line,
      line: bodyStart + index + 1,
      token: undefined,
    })),
    ...footers.map((footer) => ({
      placement: "footer",
      text: footer.value,
      line: footer.line,
      token: footer.token,
    })),
  ];
  let matchingTicket = false;
  for (const section of sections) {
    const explicitReference =
      (section.token !== undefined && referenceToken(section.token)) ||
      (section.placement !== "footer" &&
        c.tickets.required &&
        c.tickets.prefixes === null &&
        section.placement === c.tickets.placement);
    for (const match of section.text.matchAll(
      explicitReference ? referenceTicketRegex : ticketRegex,
    )) {
      const allowed =
        !c.tickets.prefixes ||
        c.tickets.prefixes.some((prefix) =>
          new RegExp(`^${escapeRegex(prefix)}[0-9]+$`).test(match[0]),
        );
      if (!allowed)
        add(
          "ticket-prefix",
          `Ticket ${match[0]} must use a configured prefix: ${c.tickets.prefixes!.join(", ")}.`,
          section.line,
          "tickets.prefixes",
        );
      const placed = section.placement === c.tickets.placement;
      const labeled =
        section.placement !== "footer" ||
        section.token === c.tickets.footerToken;
      if (!placed)
        add(
          "ticket-placement",
          `Move ticket ${match[0]} to the ${c.tickets.placement}.`,
          section.line,
          "tickets.placement",
        );
      if (
        section.placement === "footer" &&
        c.tickets.placement === "footer" &&
        !labeled
      )
        add(
          "ticket-footer-token",
          `Use ${c.tickets.footerToken}: ${match[0]} for ticket references.`,
          section.line,
          "tickets.footerToken",
        );
      matchingTicket ||= allowed && placed && labeled;
    }
  }
  if (c.tickets.required && !matchingTicket)
    add(
      "ticket-required",
      `Include a supplied ticket ID in the ${c.tickets.placement}${c.tickets.placement === "footer" ? ` using ${c.tickets.footerToken}: <ticket>` : ""}. Supply the ID yourself; do not invent one.`,
      undefined,
      "tickets.required",
    );
  return result();
}

export function formatCommitMessageDiagnostics(
  validation: CommitMessageValidation,
): string {
  return (
    validation.diagnostics
      .map(
        (item) =>
          `${item.severity === 1 ? "warning" : "error"} [${item.code}]${item.line ? ` line ${item.line}` : ""}${item.source ? ` (${item.source})` : ""}: ${item.message}`,
      )
      .join("\n") +
    (validation.valid
      ? ""
      : "\nEdit the message or regenerate with feedback before committing. For automation, correct the instructions/conventions and rerun gsmart.")
  );
}
