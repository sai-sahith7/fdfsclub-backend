

const { sendSuccess, sendError } = require("../../utils/response");

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

describe("sendSuccess", () => {
  test("returns 200 by default", () => {
    const res = mockRes();
    sendSuccess(res, { id: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe(true);
    expect(res.body.data).toEqual({ id: 1 });
    expect(res.body.message).toBe("Success");
  });

  test("accepts custom status code", () => {
    const res = mockRes();
    sendSuccess(res, null, "Created", 201);
    expect(res.statusCode).toBe(201);
    expect(res.body.message).toBe("Created");
  });

  test("accepts custom message", () => {
    const res = mockRes();
    sendSuccess(res, [], "Found items");
    expect(res.body.message).toBe("Found items");
  });
});

describe("sendError", () => {
  test("returns 500 by default", () => {
    const res = mockRes();
    sendError(res);
    expect(res.statusCode).toBe(500);
    expect(res.body.status).toBe(false);
    expect(res.body.message).toBe("Something went wrong");
  });

  test("accepts custom message and status", () => {
    const res = mockRes();
    sendError(res, "Not found", 404);
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe("Not found");
  });
});
