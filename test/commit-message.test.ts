import assert from "node:assert/strict";
import test from "node:test";
import type { CommitConventions } from "../src/definitions.ts";
import { resolveConventions } from "../src/utils/conventions.ts";
import {
  formatCommitMessageDiagnostics,
  normalizeCommitMessage,
  validateCommitMessage,
} from "../src/utils/commit-message.ts";

const validate = (message: string, settings: CommitConventions = {}) =>
  validateCommitMessage(
    message,
    resolveConventions([{ source: "repository", settings }]),
  );

for (const message of [
  "feat: add accounts",
  "fix(api)!: require authentication",
  "refactor(core): extract helper\n\nKeep the same behavior.\nAcross multiple lines.",
  "feat(api): remove legacy format\n\nBREAKING CHANGE: Use JSON.\nThe XML parser has been removed.\n\nMigration requires re-encoding stored requests.\nRefs: #12",
  "feat!: remove XML\n\nBREAKING-CHANGE: Use JSON.",
  "fix: document config\n\nExample:\n\n```yaml\nkey: value\n```",
  "docs: describe usage\r\n\r\nPreserve CRLF bodies.\r\n",
])
  test(`valid commit: ${JSON.stringify(message)}`, () =>
    assert.equal(validate(message).valid, true));

for (const message of [
  "",
  "  \n\t",
  "feat:",
  "feat: ",
  "feat:add accounts",
  "feat:  add accounts",
  " feat: add accounts",
  "feat(): add accounts",
  "feat(a(b)): add accounts",
  "feat!!: add accounts",
  "feat(a/): add accounts",
  "feat: add\u0000accounts",
  "```text\nfeat: add accounts\n```",
  '"feat: add accounts"',
  "Here is your commit message:\n\nfeat: add accounts",
  "feat: add accounts\n\nLet me know if you want a different commit message.",
  "feat!: remove XML\n\nBREAKING CHANGE:",
])
  test(`invalid commit: ${JSON.stringify(message)}`, () =>
    assert.equal(validate(message).valid, false));

test("configured types and scope components use exact schema-compatible spelling", () => {
  assert.equal(
    validate("Nouveau(界): ajouter", { types: ["Nouveau"], scopes: ["界"] })
      .valid,
    true,
  );
  assert.equal(validate("custom: add", { types: null }).valid, true);
  assert.equal(validate("custom: add").valid, false);
  for (const delimiter of ["/", "\\", ","]) {
    assert.equal(
      validate(`fix(api${delimiter}cli): add`, { scopes: ["api", "cli"] })
        .valid,
      true,
    );
    assert.equal(
      validate(`fix(api${delimiter}db): add`, { scopes: ["api", "cli"] }).valid,
      false,
    );
  }
  assert.equal(validate("fix: add", { scope: "required" }).valid, false);
  assert.equal(validate("fix(api): add", { scope: "forbidden" }).valid, false);
});

test("removing type restrictions cannot admit JSON or formatting wrappers", () => {
  for (const message of [
    '{"message": "feat: add accounts"}',
    '["feat: add accounts"]',
    "**feat: add accounts**",
    "__feat: add accounts__",
    "<message>feat: add accounts</message>",
  ])
    assert.equal(validate(message, { types: null }).valid, false, message);
});

test("length limits use UTF-16 units like commitlint and exempt URL body lines", () => {
  assert.equal(
    validate("fix: 😀", { headerMaxLength: 7, subjectMaxLength: 2 }).valid,
    true,
  );
  assert.equal(validate("fix: 😀", { headerMaxLength: 6 }).valid, false);
  assert.equal(validate("fix: 😀", { subjectMaxLength: 1 }).valid, false);
  assert.equal(
    validate("fix: add\n\n12345", { body: { maxLineLength: 5 } }).valid,
    true,
  );
  assert.equal(
    validate("fix: add\n\n123456", { body: { maxLineLength: 5 } }).valid,
    false,
  );
  assert.equal(
    validate("fix: add\n\nSee https://example.com/long/path", {
      body: { maxLineLength: 5 },
    }).valid,
    true,
  );
});

test("body and footer presence and separators are independent", () => {
  assert.equal(validate("fix: add\nBody").valid, false);
  assert.equal(
    validate("fix: add\nBody", { body: { leadingBlank: false } }).valid,
    true,
  );
  assert.equal(
    validate("fix: add\n\nBody", { body: { leadingBlank: false } }).valid,
    false,
  );
  assert.equal(
    validate("fix: add\n\nRefs: #1", { body: { presence: "required" } }).valid,
    false,
  );
  assert.equal(
    validate("fix: add\n\nRefs: #1", { body: { presence: "forbidden" } }).valid,
    true,
  );
  assert.equal(
    validate("fix: add\n\nBody", { body: { presence: "forbidden" } }).valid,
    false,
  );
  assert.equal(validate("fix: add\n\nBody\nRefs: #1").valid, false);
  assert.equal(
    validate("fix: add\n\nBody\nRefs: #1", { footer: { leadingBlank: false } })
      .valid,
    true,
  );
  assert.equal(
    validate("fix: add\nRefs: #1", { footer: { leadingBlank: false } }).valid,
    true,
  );
  assert.equal(
    validate("fix: add\n\nBody\n\nRefs: #1\nReviewed-by: Alice").valid,
    true,
  );
});

test("a required breaking footer is conditional on a breaking marker", () => {
  const breakingChanges = { requireFooter: true };
  assert.equal(validate("feat: add an API", { breakingChanges }).valid, true);
  assert.equal(validate("feat!: change API", { breakingChanges }).valid, false);
  assert.equal(
    validate("feat!: change API\n\nBREAKING-CHANGE: Supply options.", {
      breakingChanges,
    }).valid,
    true,
  );
  assert.equal(
    validate("feat: change API\n\nBREAKING CHANGE: Supply options.", {
      breakingChanges,
    }).valid,
    true,
  );
});

test("tickets respect numeric IDs, escaped prefixes, placement, and footer label", () => {
  const tickets = { prefixes: ["APP-", "C++-"], required: true };
  assert.equal(
    validate("fix: add\n\nRefs: APP-12, C++-34", { tickets }).valid,
    true,
  );
  for (const reference of ["OTHER-12", "APP-12x", "APP-", "APP-x"])
    assert.equal(
      validate(`fix: add\n\nRefs: ${reference}`, { tickets }).valid,
      false,
    );
  assert.equal(validate("fix: add APP-12", { tickets }).valid, false);
  assert.equal(
    validate("fix: add APP-12", {
      tickets: { ...tickets, placement: "subject" },
    }).valid,
    true,
  );
  assert.equal(
    validate("fix: add\n\nAddress APP-12.", {
      tickets: { ...tickets, placement: "body" },
    }).valid,
    true,
  );
  assert.equal(
    validate("fix: add\n\nCloses: APP-12", { tickets }).valid,
    false,
  );
  assert.equal(
    validate("fix: add\n\nCloses #12", {
      tickets: { required: true, footerToken: "Closes" },
    }).valid,
    true,
  );
  assert.equal(
    validate("fix: add\n\nRefs: #12", { tickets: { required: true } }).valid,
    true,
  );
  assert.equal(
    validate("fix: add", { tickets: { required: true } }).valid,
    false,
  );
});

test("effective warnings are nonblocking and explicit overrides regain error severity", () => {
  const imported = {
    source: "commitlint",
    settings: { headerMaxLength: 10 },
    ruleMetadata: {
      headerMaxLength: { name: "header-max-length", severity: 1 as const },
    },
  };
  const effective = resolveConventions([imported]);
  const before = structuredClone(effective);
  const result = validateCommitMessage("feat: add accounts", effective);
  assert.equal(result.valid, true);
  assert.deepEqual(result.diagnostics, [
    {
      code: "header-max-length",
      severity: 1,
      message: "Header must be at most 10 characters (received 18).",
      line: 1,
      source: "commitlint",
      rule: "header-max-length",
    },
  ]);
  assert.match(
    formatCommitMessageDiagnostics(result),
    /warning.*header-max-length/i,
  );
  assert.deepEqual(effective, before);
  assert.deepEqual(
    validateCommitMessage("feat: add accounts", effective),
    result,
  );
  assert.equal(
    validateCommitMessage(
      "feat: add accounts",
      resolveConventions([
        imported,
        { source: "repository", settings: { headerMaxLength: 10 } },
      ]),
    ).valid,
    false,
  );
  assert.equal(validateCommitMessage("bad header", effective).valid, false);
});

test("normalization only changes line endings and trailing newlines", () => {
  assert.equal(
    normalizeCommitMessage(" fix: add \r\n\r\nBody\r\n"),
    " fix: add \n\nBody",
  );
  assert.equal(validate(" fix: add\n").valid, false);
});

test("technical terms are not treated as bare ticket references", () => {
  for (const settings of [{}, { tickets: { prefixes: ["APP-"] } }]) {
    assert.equal(validate("fix: decode UTF-8 correctly", settings).valid, true);
    assert.equal(validate("feat: add SHA-256 checksums", settings).valid, true);
    assert.equal(
      validate(
        "fix: decode input\n\nPreserve UTF-8 text and SHA-256 digests.",
        settings,
      ).valid,
      true,
    );
    for (const token of [
      "Signed-off-by",
      "Reviewed-by",
      "Notes",
      "BREAKING CHANGE",
    ])
      assert.equal(
        validate(
          `fix: decode input\n\n${token}: Preserve UTF-8 and SHA-256.`,
          settings,
        ).valid,
        true,
        token,
      );
  }
  assert.equal(
    validate("fix: decode input\n\nRefs: OTHER-42", {
      tickets: { prefixes: ["APP-"] },
    }).valid,
    false,
  );
  assert.equal(validate("fix: decode input\n\nRefs: PROJ-42").valid, true);
});

test("required project tickets with unrestricted prefixes are recognized in the requested section", () => {
  for (const placement of ["subject", "body"] as const) {
    const tickets = { required: true, placement };
    const message =
      placement === "subject"
        ? "fix: address APP-42"
        : "fix: handle input\n\nAddress APP-42.";
    assert.equal(validate(message, { tickets }).valid, true);
    const missing = validate(
      "fix: handle input\n\nPreserve existing behavior.",
      { tickets },
    );
    assert.ok(
      missing.diagnostics.some(({ code }) => code === "ticket-required"),
    );
  }
});

test("configured literal prefixes and hash references remain checked outside reference footers", () => {
  for (const reference of ["APP-42", "C++-12", "#123"]) {
    for (const message of [
      `fix: address ${reference}`,
      `fix: handle input\n\nAddress ${reference}.`,
      `fix: handle input\n\nReviewed-by: ${reference}`,
    ]) {
      const result = validate(message, {
        tickets: { prefixes: ["APP-", "C++-", "#"] },
      });
      assert.equal(result.valid, false, message);
      assert.ok(
        result.diagnostics.some(
          ({ code }) =>
            code === "ticket-placement" || code === "ticket-footer-token",
        ),
      );
    }
  }
  assert.equal(
    validate("fix: handle input\n\nTickets: PROJ-42", {
      tickets: { footerToken: "Tickets" },
    }).valid,
    true,
  );
  assert.ok(
    validate("fix: handle input\n\nCloses: OTHER-42", {
      tickets: { prefixes: ["APP-"] },
    }).diagnostics.some(({ code }) => code === "ticket-prefix"),
  );
});

test("colon-prefixed prose inside a body paragraph does not start a footer", () => {
  const message =
    "fix: refresh cached entries\n\nRebuild cached entries.\nNote: preserve the old key format.";
  assert.equal(validate(message).valid, true);
  assert.equal(validate(message, { body: { maxLineLength: 25 } }).valid, false);
});

test("generic footers start at section boundaries or follow explicit separator settings", () => {
  const message = "fix: handle input\n\nBody paragraph.\nNotes: details";
  assert.equal(
    validate(message, { footer: { leadingBlank: false } }).valid,
    true,
  );
  assert.equal(
    validate(
      "fix: handle input\n\nBody paragraph.\n\nNotes: details\nExtra: more",
    ).valid,
    true,
  );
  const adjacent = validate("fix: handle input\nNotes: details");
  assert.deepEqual(
    adjacent.diagnostics.map(({ code }) => code),
    ["footer-leadingBlank"],
  );
  assert.equal(
    validate("fix: handle input\nNotes: details", {
      footer: { leadingBlank: false },
    }).valid,
    true,
  );
});

test("recognized trailers still report missing separators inside a body paragraph", () => {
  for (const token of [
    "Refs",
    "Closes",
    "Fixes",
    "Resolves",
    "Signed-off-by",
    "Reviewed-by",
    "Tickets",
    "BREAKING CHANGE",
    "BREAKING-CHANGE",
  ]) {
    const message = `fix: handle input\n\nBody paragraph.\n${token}: details`;
    const result = validate(message, { tickets: { footerToken: "Tickets" } });
    assert.deepEqual(
      result.diagnostics.map(({ code }) => code),
      ["footer-leadingBlank"],
      token,
    );
    assert.equal(
      validate(message, {
        tickets: { footerToken: "Tickets" },
        footer: { leadingBlank: false },
      }).valid,
      true,
      token,
    );
  }
});

test("breaking footers require the Conventional Commits colon-space separator", () => {
  for (const token of ["BREAKING CHANGE", "BREAKING-CHANGE"]) {
    for (const separator of [":", ":\t", " ", " : "]) {
      const message = `feat!: remove v1\n\n${token}${separator}remove v1 support`;
      assert.equal(validate(message).valid, false);
      assert.equal(
        validate(message, { breakingChanges: { requireFooter: true } }).valid,
        false,
      );
    }
    assert.equal(validate(`fix: handle input\n\n${token}`).valid, false);
  }
});

test("fenced body examples are not mistaken for model explanations", () => {
  assert.equal(
    validate(
      "docs: demonstrate output\n\n```text\nLet me know if you want a different commit message.\n```",
      { body: { presence: "required" } },
    ).valid,
    true,
  );
  for (const marker of ["```", "~~~", "````"]) {
    const message = `docs: demonstrate output\n\n${marker}text\nLet me know if this example helps.\nBREAKING CHANGE:no separator in this example\n${marker}\n`;
    assert.equal(validate(message).valid, true);
    assert.equal(
      validate(message + "\nLet me know if you want another message.").valid,
      false,
    );
    assert.equal(
      validate(message + "\nBREAKING CHANGE:no separator").valid,
      false,
    );
  }
  assert.equal(
    validate(
      "docs: demonstrate fences\n\n````text\n```\nLet me know if this example helps.\n```\n````",
    ).valid,
    true,
  );
});
