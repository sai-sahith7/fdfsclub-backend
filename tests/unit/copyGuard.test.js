const fs = require("fs");
const path = require("path");

const USER_FACING_FILES = [
  "services/telegramConversationService.js",
  "services/alertService.js",
  "services/locationService.js",
  "services/movieSearchService.js",
  "controllers/userController.js",
  "controllers/alertController.js",
  "controllers/cityController.js",
  "controllers/movieController.js",
  "controllers/authController.js",
  "middleware/auth.js",
  "middleware/rateLimit.js",
  "templates/alertEmailTemplate.html",
];

const FORBIDDEN = /\b(district|bookmyshow|bms|scrap\w*|sync\w*|provider|worker|upstream|api)\b/i;
const STRING_LITERAL = /(["'`])((?:\\.|(?!\1).)*)\1/g;

function userStrings(file) {
  const source = fs.readFileSync(path.join(__dirname, "../..", file), "utf8");
  const found = [];
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("<!--")) continue;
    if (/require\(|logger\.|TAG|process\.env|callback_data|\.find|\.select\(|\.test\(|console\./.test(line)) continue;
    if (file.endsWith(".html")) {
      const text = line.replace(/<[^>]*>/g, " ").trim();
      if (text) found.push(text);
      continue;
    }
    for (const match of line.matchAll(STRING_LITERAL)) found.push(match[2]);
  }
  return found;
}

describe("user-facing copy never exposes internals", () => {
  test.each(USER_FACING_FILES)("%s", (file) => {
    const offending = userStrings(file).filter((text) => FORBIDDEN.test(text) && !/^(district|bookmyshow)$/.test(text));
    expect(offending).toEqual([]);
  });
});
