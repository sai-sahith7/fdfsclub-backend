const LEVELS = { info: "INFO", warn: "WARN", error: "ERROR", debug: "DEBUG" };

const debugEnabled = () => String(process.env.LOG_LEVEL || "").toLowerCase() === "debug";

function formatTimestamp() {
  const d = new Date();
  const options = {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  };
  return d.toLocaleString('en-IN', options).replace(',', '');
}

function log(level, tag, message, data) {
  const prefix = `[${formatTimestamp()}] [${level}] [${tag}]`;
  if (data !== undefined) {
    console.log(`${prefix} ${message}`, typeof data === "object" ? JSON.stringify(data, null, 2) : data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

const logger = {
  info:  (tag, message, data) => log(LEVELS.info, tag, message, data),
  warn:  (tag, message, data) => log(LEVELS.warn, tag, message, data),
  error: (tag, message, data) => log(LEVELS.error, tag, message, data),
  debug: (tag, message, data) => { if (debugEnabled()) log(LEVELS.debug, tag, message, data); },
};

module.exports = logger;
