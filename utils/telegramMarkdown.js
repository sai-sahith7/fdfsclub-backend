function escapeMarkdown(value) {
  if (value == null) return "";
  return String(value).replace(/([_*`[])/g, "\\$1");
}

module.exports = { escapeMarkdown };
