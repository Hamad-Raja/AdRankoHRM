const {
  randomBytes,
  createHash,
  timingSafeEqual,
} = require("node:crypto");

const TOKEN_BYTES = 32;
const TOKEN_LENGTH = TOKEN_BYTES * 2;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function isValidToken(token) {
  return (
    typeof token === "string" &&
    token.length === TOKEN_LENGTH &&
    TOKEN_PATTERN.test(token)
  );
}

function generateToken() {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

function hashToken(token) {
  if (!isValidToken(token)) {
    throw new TypeError(
      "Token must contain exactly 64 lowercase hexadecimal characters."
    );
  }

  return createHash("sha256")
    .update(token, "utf8")
    .digest("hex");
}

function verifyToken(token, storedHash) {
  if (!isValidToken(token) || !isValidToken(storedHash)) {
    return false;
  }

  const receivedHash = Buffer.from(hashToken(token), "hex");
  const expectedHash = Buffer.from(storedHash, "hex");

  return timingSafeEqual(receivedHash, expectedHash);
}

module.exports = {
  TOKEN_LENGTH,
  isValidToken,
  generateToken,
  hashToken,
  verifyToken,
};