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

for (const type of ["[bot]", "<release>", "**meta"]) {
  test(`PR 508: an explicitly configured ${type} type is not an output wrapper`, () => {
    for (const header of [
      `${type}: update dependencies`,
      `${type}(deps)!: update dependencies`,
    ]) {
      const result = validate(
        header + "\n\nPreserve the configured type spelling.",
        { types: [type], scopes: ["deps"] },
      );
      assert.deepEqual(result, { valid: true, diagnostics: [] });
    }
  });
}

for (const token of ["BREAKING CHANGE", "BREAKING-CHANGE"]) {
  test(`PR 508: ordinary ${token} prose is not a malformed trailer`, () => {
    const prose = `${token} handling is documented below.`;
    for (const body of [
      prose,
      `Describe the format.\n${prose}`,
      `Describe the format.\n\n${prose}`,
    ]) {
      const result = validate(`docs: clarify conventions\n\n${body}`, {
        body: { presence: "required" },
      });
      assert.deepEqual(result, { valid: true, diagnostics: [] });
    }
  });
}

for (const marker of ["```", "~~~", "````"]) {
  test(`PR 508: fenced ticket examples do not violate real ticket placement (${marker})`, () => {
    const message = `docs: show commit examples\n\nExample syntax:\n\n${marker}text\nfix: address #123 and APP-123\n${marker}\n\nRefs: #456`;
    const result = validate(message, {
      tickets: { prefixes: ["#"], required: true },
    });
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.deepEqual(result.diagnostics, []);
  });

  test(`PR 508: fenced examples cannot satisfy a required body ticket (${marker})`, () => {
    const example = `docs: show commit examples\n\nExample syntax:\n\n${marker}text\nfix: address #123\n${marker}`;
    const rules = { tickets: { required: true, placement: "body" as const } };
    const missing = validate(example, rules);
    assert.equal(missing.valid, false);
    assert.deepEqual(
      missing.diagnostics.map(({ code }) => code),
      ["ticket-required"],
    );
    assert.equal(
      validate(example + "\n\nDocument the change for #456.", rules).valid,
      true,
    );
  });
}

test("fenced custom tickets and fence info strings are ignored in every placement", () => {
  for (const marker of ["```", "~~~", "````"]) {
    for (const placement of ["subject", "body", "footer"] as const) {
      const example = `docs: show references${placement === "subject" ? " C++-456" : ""}\n\n${marker}text #123 C++-123\nfix: address APP-123 and #123\n${marker}`;
      const message =
        example +
        (placement === "body"
          ? "\n\nDocument C++-456."
          : placement === "footer"
            ? "\n\nTickets: C++-456"
            : "");
      const result = validate(message, {
        tickets: {
          prefixes: ["APP-", "C++-"],
          required: true,
          placement,
          footerToken: "Tickets",
        },
      });
      assert.deepEqual(result, { valid: true, diagnostics: [] }, message);
    }
  }
});

test("ticket scanning respects nested fence examples and longer closing markers", () => {
  for (const example of [
    "````markdown\n```text\n#123 APP-123\n```\n#234 APP-234\n````",
    "~~~text\n```\n#123 APP-123\n```\n#234 APP-234\n~~~",
    "```text\n~~~\n#123 APP-123\n~~~\n#234 APP-234\n```",
    "```text\n```text #123\n#234 APP-234\n````",
    "~~~~text\n~~~\n#123 APP-123\n~~~~~",
  ]) {
    for (const placement of ["body", "footer"] as const) {
      const message = `docs: show references\n\n${placement === "footer" ? "Refs: Examples\n" : ""}${example}`;
      const settings = { tickets: { required: true, placement } };
      const missing = validate(message, settings);
      assert.equal(missing.valid, false, message);
      assert.deepEqual(
        missing.diagnostics.map(({ code }) => code),
        ["ticket-required"],
        message,
      );
      assert.deepEqual(validate(message + "\nAddress APP-456.", settings), {
        valid: true,
        diagnostics: [],
      });
    }
  }
});

test("unclosed fences exclude remaining ticket examples in bodies and footer continuations", () => {
  for (const marker of ["```", "~~~", "````"]) {
    for (const placement of ["body", "footer"] as const) {
      const message = `docs: show references\n\n${placement === "footer" ? "Refs: Examples\n" : ""}${marker}text #123\n#234 APP-234\n\nRefs: #456`;
      assert.deepEqual(validate(message), { valid: true, diagnostics: [] });
      const missing = validate(message, {
        tickets: { required: true, placement },
      });
      assert.equal(missing.valid, false);
      assert.deepEqual(
        missing.diagnostics.map(({ code }) => code),
        ["ticket-required"],
      );
    }
  }
});

test("real body tickets after a fence retain prefix and placement errors at their original line", () => {
  const message =
    "docs: show references\n\nExample syntax:\n\n```text\nAPP-123 #123\n```\nAddress #456.\n\nRefs: APP-789";
  const result = validate(message, {
    tickets: { prefixes: ["APP-"], required: true },
  });
  assert.equal(result.valid, false);
  assert.deepEqual(
    result.diagnostics.map(({ code, line }) => ({ code, line })),
    [
      { code: "ticket-prefix", line: 8 },
      { code: "ticket-placement", line: 8 },
    ],
  );
  for (const diagnostic of result.diagnostics)
    assert.match(diagnostic.message, /#456/);
});

test("fenced footer continuations neither satisfy required tickets nor cause ticket errors", () => {
  const settings = {
    tickets: {
      prefixes: ["APP-", "C++-"],
      required: true,
      footerToken: "Tickets",
    },
  };
  for (const marker of ["```", "~~~", "````"]) {
    for (const token of ["Tickets", "Closes", "Notes", "BREAKING CHANGE"]) {
      const message = `docs: show references\n\n${token}: Examples\n${marker}text #123\nAPP-123 C++-123 #123\n${marker}`;
      const missing = validate(message, settings);
      assert.equal(missing.valid, false);
      assert.deepEqual(
        missing.diagnostics.map(({ code }) => code),
        ["ticket-required"],
        message,
      );
      assert.deepEqual(validate(message + "\n\nTickets: C++-456", settings), {
        valid: true,
        diagnostics: [],
      });
      if (token === "Tickets")
        assert.deepEqual(validate(message + "\nAddress C++-456.", settings), {
          valid: true,
          diagnostics: [],
        });
    }
  }
});

test("real footer continuation tickets retain their token context and original line", () => {
  for (const [settings, codes] of [
    [
      { tickets: { prefixes: ["APP-"] } },
      ["ticket-prefix", "ticket-footer-token"],
    ],
    [{ tickets: { placement: "body" } }, ["ticket-placement"]],
  ] satisfies [CommitConventions, string[]][]) {
    const message =
      "docs: show references\n\nCloses: Examples\n\n```text\nAPP-123 #123\n```\nAddress OTHER-456.";
    const result = validate(message, settings);
    assert.equal(result.valid, false);
    assert.deepEqual(
      result.diagnostics.map(({ code, line }) => ({ code, line })),
      codes.map((code) => ({ code, line: 8 })),
    );
    for (const diagnostic of result.diagnostics)
      assert.match(diagnostic.message, /OTHER-456/);
  }
});

test("ignoring fenced tickets preserves body presence and line-length rules", () => {
  const message = "docs: show references\n\n```text\nfix: address #123\n```";
  assert.deepEqual(validate(message, { body: { presence: "required" } }), {
    valid: true,
    diagnostics: [],
  });
  const forbidden = validate(message, { body: { presence: "forbidden" } });
  assert.deepEqual(
    forbidden.diagnostics.map(({ code, line }) => ({ code, line })),
    [{ code: "body-presence", line: 3 }],
  );
  const tooLong = validate(message, { body: { maxLineLength: 10 } });
  assert.deepEqual(
    tooLong.diagnostics.map(({ code, line }) => ({ code, line })),
    [{ code: "body-max-line-length", line: 4 }],
  );
});

test("PR 508: ordinary body prose about commit messages is not a wrapper", () => {
  for (const body of [
    "The commit message uses the configured format.",
    "This commit message follows the documented conventions.",
    "Here is the commit message format accepted by the validator.",
    "Let me know if the documented migration needs clarification.",
    "Would you like me to retain this example? This is the documented prompt.",
    "Validation checklist:\n- Headers use the configured format.",
  ]) {
    for (const message of [
      `docs: clarify validation\n\n${body}`,
      `docs: clarify validation\n\nDocument the accepted format.\n\n${body}\n\nRefs: #508`,
    ]) {
      const result = validate(message, { body: { presence: "required" } });
      assert.equal(result.valid, true, JSON.stringify({ message, result }));
      assert.deepEqual(result.diagnostics, []);
    }
  }
});

test("PR 508: trailer values and continuations about commit messages are not wrappers", () => {
  for (const prose of [
    "The commit message uses the configured format.",
    "Here is the commit message format accepted by the validator.",
    "Let me know if you want a different commit message.",
    "Validation checklist:\n- Headers use the configured format.",
  ]) {
    for (const value of [prose, `Describe the accepted format.\n${prose}`]) {
      const message = `docs: clarify validation\n\nNotes: ${value}`;
      const result = validate(message, { body: { presence: "forbidden" } });
      assert.equal(result.valid, true, JSON.stringify({ message, result }));
      assert.deepEqual(result.diagnostics, []);
    }
  }
});

for (const message of [
  "feat: add accounts",
  "fix(api)!: require authentication",
  "refactor(core): extract helper\n\nKeep the same behavior.\nAcross multiple lines.",
  "feat(api): remove legacy format\n\nBREAKING CHANGE: Use JSON.\nThe XML parser has been removed.\n\nMigration requires re-encoding stored requests.\nRefs: #12",
  "feat!: remove XML\n\nBREAKING-CHANGE: Use JSON.",
  "fix: document config\n\nExample:\n\n```yaml\nkey: value\n```",
  "docs: describe usage\r\n\r\nPreserve CRLF bodies.\r\n",
  "feat: add accounts\n\nLet me know if you want a different commit message.",
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
  "feat!: remove XML\n\nBREAKING CHANGE:",
])
  test(`invalid commit: ${JSON.stringify(message)}`, () => {
    for (const settings of [{}, { types: null }])
      assert.equal(validate(message, settings).valid, false);
  });

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

test("schema-compatible punctuation types are accepted with exact explicit membership", () => {
  for (const type of [
    "[bot]",
    "<release>",
    "**meta",
    "__internal",
    "{meta}",
    '"quoted"',
    "'quoted'",
    "`meta`",
    "```meta",
    "~~~meta",
    "build+meta",
    "ci/build",
    "ci\\build",
    "ci,build",
    "meta.v2",
    "🚀",
  ]) {
    // resolveConventions validates these settings against the repository schema.
    const result = validate(
      `${type}(deps)!: refresh metadata\n\nPreserve behavior.\n\nBREAKING CHANGE: Use the new format.`,
      {
        types: [type],
        scopes: ["deps"],
        scope: "required",
        body: { presence: "required" },
        breakingChanges: { requireFooter: true },
      },
    );
    assert.deepEqual(result, { valid: true, diagnostics: [] }, type);
  }
});

test("wrapper-like type spellings require an exact configured type", () => {
  for (const type of ["[bot]", "<release>", "**meta", "__meta", "'meta'"]) {
    for (const settings of [
      {},
      { types: null },
      { types: [type.toUpperCase()] },
      { types: [`${type}-other`] },
    ]) {
      const result = validate(`${type}: update metadata`, settings);
      assert.equal(result.valid, false);
      assert.ok(
        result.diagnostics.some(
          ({ code, severity }) => code === "wrapper" && severity === 2,
        ),
      );
    }
  }
});

test("wrapping an explicitly configured header is still rejected", () => {
  for (const type of ["fix", "[bot]", "<release>", "**meta", '"quoted"']) {
    const header = `${type}(deps): update metadata`;
    for (const message of [
      JSON.stringify(header),
      `'${header}'`,
      `\`${header}\``,
      `\`\`\`text\n${header}\n\`\`\``,
      `~~~text\n${header}\n~~~`,
      JSON.stringify({ message: header }),
      JSON.stringify([header]),
      `[${header}]`,
      `**${header}**`,
      `__${header}__`,
      `<message>${header}</message>`,
      `Here is your commit message:\n\n${header}`,
    ]) {
      const result = validate(message, { types: [type] });
      assert.equal(result.valid, false, message);
      assert.ok(
        result.diagnostics.some(
          ({ code, severity }) => code === "wrapper" && severity === 2,
        ),
        message,
      );
    }
  }
});

test("configured punctuation does not exempt malformed headers or other rules", () => {
  for (const type of ["[bot]", "<release>", "**meta"]) {
    for (const header of [
      `${type}:`,
      `${type}: `,
      `${type}:update metadata`,
      `${type}:  update metadata`,
      `${type}(): update metadata`,
      `${type}(deps!!): update metadata`,
      ` ${type}: update metadata`,
    ]) {
      const result = validate(header, { types: [type] });
      assert.equal(result.valid, false, header);
      assert.ok(
        result.diagnostics.some(
          ({ code, severity }) => code === "header" && severity === 2,
        ),
        header,
      );
    }
    for (const [suffix, settings, expected] of [
      [": update metadata", { scope: "required" }, "scope-presence"],
      ["(deps): update metadata", { scope: "forbidden" }, "scope-presence"],
      ["(other): update metadata", { scopes: ["deps"] }, "scope-enum"],
      ["(deps/): update metadata", {}, "scope"],
      [": update metadata", { headerMaxLength: 5 }, "header-max-length"],
      [": update metadata", { subjectMaxLength: 5 }, "subject-max-length"],
      [": update\u0000metadata", {}, "control-character"],
      [
        ": update metadata",
        { body: { presence: "required" } },
        "body-presence",
      ],
      [
        ": update metadata\n\nDetails.",
        { body: { presence: "forbidden" } },
        "body-presence",
      ],
      [
        ": update metadata\n\nDetails.",
        { body: { maxLineLength: 5 } },
        "body-max-line-length",
      ],
      [": update metadata\nDetails.", {}, "body-leadingBlank"],
      [": update metadata\nRefs: #123", {}, "footer-leadingBlank"],
      [": update metadata", { tickets: { required: true } }, "ticket-required"],
      [
        "!: update metadata",
        { breakingChanges: { requireFooter: true } },
        "breaking-footer",
      ],
    ] satisfies [string, CommitConventions, string][]) {
      const result = validate(type + suffix, { ...settings, types: [type] });
      assert.equal(result.valid, false, type + suffix);
      assert.deepEqual(
        result.diagnostics.map(({ code, severity }) => ({ code, severity })),
        [{ code: expected, severity: 2 }],
        type + suffix,
      );
    }
  }
});

test("configured punctuation preserves imported rule warning severity", () => {
  const result = validateCommitMessage(
    "[bot]: update dependencies",
    resolveConventions([
      {
        source: "commitlint",
        settings: { types: ["[bot]"], headerMaxLength: 10 },
        ruleMetadata: {
          headerMaxLength: { name: "header-max-length", severity: 1 },
        },
      },
    ]),
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.diagnostics, [
    {
      code: "header-max-length",
      severity: 1,
      message: "Header must be at most 10 characters (received 26).",
      line: 1,
      source: "commitlint",
      rule: "header-max-length",
    },
  ]);
});

test("leading preambles and formatting wrappers are rejected even with unrestricted types", () => {
  for (const message of [
    "Here is your commit message:\n\nfeat: add accounts",
    "Here's a suggested commit message:\n\nfeat: add accounts",
    "The commit message uses the configured format.\n\nfeat: add accounts",
    "Validation checklist:\n- Headers use the configured format.\n\nfeat: add accounts",
    "Let me know if this works:\n\nfeat: add accounts",
    "Would you like me to use this?\n\nfeat: add accounts",
    '{"message": "feat: add accounts"}',
    '["feat: add accounts"]',
    '"feat: add accounts"',
    "'feat: add accounts'",
    "`feat: add accounts`",
    "```text\nfeat: add accounts\n```",
    "~~~text\nfeat: add accounts\n~~~",
    "**feat: add accounts**",
    "__feat: add accounts__",
    "<message>feat: add accounts</message>",
  ])
    for (const settings of [{}, { types: null }]) {
      const result = validate(message, settings);
      assert.equal(result.valid, false, message);
      assert.ok(
        result.diagnostics.some(
          ({ code, severity }) => code === "wrapper" && severity === 2,
        ),
        message,
      );
    }
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
    for (const separator of [":", ":\t", " : ", "\t: ", " \t:\t"]) {
      const message = `feat!: remove v1\n\n${token}${separator}remove v1 support`;
      assert.equal(validate(message).valid, false);
      assert.equal(
        validate(message, { breakingChanges: { requireFooter: true } }).valid,
        false,
      );
    }
    for (const whitespace of ["", " ", "\t", " \t "]) {
      const result = validate(`fix: handle input\n\n${token}${whitespace}`);
      assert.equal(result.valid, false);
      assert.deepEqual(
        result.diagnostics.map(({ code, severity, line }) => ({
          code,
          severity,
          line,
        })),
        [{ code: "breaking-footer-format", severity: 2, line: 3 }],
      );
    }
  }
});

test("breaking-token prose is body content or a footer continuation, not a breaking footer", () => {
  for (const token of ["BREAKING CHANGE", "BREAKING-CHANGE"]) {
    for (const prose of [
      `${token} handling is documented below.`,
      `${token}\thandling: see the documentation.`,
      `${token} remove v1 support`,
      `${token} #123 documents the migration.`,
    ]) {
      for (const continuation of [false, true]) {
        const content = continuation
          ? `Notes: Format documentation.\n${prose}`
          : prose;
        const settings: CommitConventions = {
          body: { presence: continuation ? "forbidden" : "required" },
          tickets: {
            placement: continuation ? "footer" : "body",
            footerToken: "Notes",
          },
          breakingChanges: { requireFooter: true },
        };
        assert.deepEqual(
          validate(`docs: clarify conventions\n\n${content}`, settings),
          {
            valid: true,
            diagnostics: [],
          },
        );
        const missing = validate(
          `docs!: clarify conventions\n\n${content}`,
          settings,
        );
        assert.equal(missing.valid, false);
        assert.deepEqual(
          missing.diagnostics.map(({ code, severity }) => ({ code, severity })),
          [{ code: "breaking-footer", severity: 2 }],
        );
        assert.deepEqual(
          validate(
            `docs!: clarify conventions\n\n${content}\n\n${token}: Migrate the old configuration.`,
            settings,
          ),
          { valid: true, diagnostics: [] },
        );
      }
    }
    for (const separator of [" ", "\t"]) {
      assert.deepEqual(
        validate(`feat!: remove v1\n\n${token}${separator}remove v1 support`),
        {
          valid: true,
          diagnostics: [],
        },
      );
    }
  }
});

test("breaking-token body prose remains subject to body limits and separators", () => {
  for (const token of ["BREAKING CHANGE", "BREAKING-CHANGE"]) {
    const prose = `${token} handling is documented below.`;
    for (const [separator, settings, code] of [
      ["\n\n", { body: { presence: "forbidden" } }, "body-presence"],
      ["\n\n", { body: { maxLineLength: 20 } }, "body-max-line-length"],
      ["\n", {}, "body-leadingBlank"],
    ] satisfies [string, CommitConventions, string][]) {
      const result = validate(
        `docs: clarify conventions${separator}${prose}`,
        settings,
      );
      assert.equal(result.valid, false);
      assert.deepEqual(
        result.diagnostics.map(({ code, severity, line }) => ({
          code,
          severity,
          line,
        })),
        [{ code, severity: 2, line: separator === "\n" ? 2 : 3 }],
      );
    }
  }
});

test("trailers reject empty or whitespace-only values, including before another trailer", () => {
  for (const token of ["Notes", "Refs", "BREAKING CHANGE", "BREAKING-CHANGE"]) {
    for (const value of ["", " \t", "\n \t\n"]) {
      for (const following of ["", "\nReviewed-by: Alice"]) {
        const result = validate(
          `fix: document trailers\n\n${token}: ${value}${following}`,
        );
        assert.equal(result.valid, false);
        assert.deepEqual(result.diagnostics, [
          {
            code: "footer-empty",
            severity: 2,
            message: `Supply a value for ${token}${token.startsWith("BREAKING") ? " explaining the breaking change" : ""}.`,
            line: 3,
          },
        ]);
      }
    }
  }
});

test("an initially empty trailer value accepts nonempty multiline continuation", () => {
  for (const token of ["Notes", "Refs", "BREAKING CHANGE", "BREAKING-CHANGE"]) {
    const result = validate(
      `feat${token.startsWith("BREAKING") ? "!" : ""}: document trailers\n\n${token}: \n \t\nDescribe the migration.\nPreserve existing records.\nReviewed-by: Alice`,
      { breakingChanges: { requireFooter: true } },
    );
    assert.equal(result.valid, true, token);
    assert.deepEqual(result.diagnostics, []);
  }
});

test("fenced body examples are excluded from trailer parsing", () => {
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
      true,
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
