const jwt = require("jsonwebtoken");

const JWT_ALGORITHM = "HS256";
const JWT_EXPIRES_IN = "7d";

const generateToken = (user) => {
  const payload = {
    email: user.email,
    name: user.name,
  };

  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, algorithm: JWT_ALGORITHM });
};

module.exports = { generateToken, JWT_ALGORITHM, JWT_EXPIRES_IN };
