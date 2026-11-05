const logger = require("../../utils/logger");

describe("logger", () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "log").mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test("logger.info outputs INFO level", () => {
    logger.info("TestTag", "Hello world");
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("[INFO]");
    expect(output).toContain("[TestTag]");
    expect(output).toContain("Hello world");
  });

  test("logger.warn outputs WARN level", () => {
    logger.warn("TestTag", "Warning message");
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("[WARN]");
  });

  test("logger.error outputs ERROR level", () => {
    logger.error("TestTag", "Error message");
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("[ERROR]");
  });

  test("logger.debug outputs DEBUG level when LOG_LEVEL=debug", () => {
    process.env.LOG_LEVEL = "debug";
    logger.debug("TestTag", "Debug message");
    delete process.env.LOG_LEVEL;
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("[DEBUG]");
  });

  test("logger.debug is silent by default", () => {
    delete process.env.LOG_LEVEL;
    logger.debug("TestTag", "Debug message");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  test("includes timestamp in format", () => {
    logger.info("TestTag", "Timestamped");
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toMatch(/\[\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}\]/);
  });

  test("handles data parameter (string)", () => {
    logger.info("TestTag", "With data", "extra-info");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("With data"),
      "extra-info"
    );
  });

  test("handles data parameter (object)", () => {
    logger.info("TestTag", "With object", { key: "value" });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("With object"),
      expect.stringContaining('"key": "value"')
    );
  });

  test("handles undefined data", () => {
    logger.info("TestTag", "No data");
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0].length).toBe(1);
  });
});
