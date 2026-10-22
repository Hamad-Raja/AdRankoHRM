const bcrypt = require("bcryptjs");

const SALT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72;

async function hashPassword(password) {
  if (typeof password !== "string") {
    throw new TypeError("Password must be a string.");
  }

  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    throw new RangeError(
      `Password must not exceed ${MAX_PASSWORD_BYTES} UTF-8 bytes.`
    );
  }

  if (Array.from(password).length < MIN_PASSWORD_LENGTH) {
    throw new RangeError(
      `Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }

  // Passing the cost generates a fresh random salt for each hash.
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password, passwordHash) {
  if (typeof password !== "string" || typeof passwordHash !== "string") {
    return false;
  }

  if (
    password.length === 0 ||
    Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES ||
    passwordHash.length === 0
  ) {
    return false;
  }

  // Passwords are compared exactly, without trimming or modification.
  return bcrypt.compare(password, passwordHash);
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
  hashPassword,
  verifyPassword,
};