const { z } = require("zod");

const {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
} = require("../utils/password");

const emailSchema = z
  .string({ error: "Email must be a string." })
  .trim()
  .toLowerCase()
  .min(1, { error: "Email is required." })
  .max(254, { error: "Email must not exceed 254 characters." })
  .pipe(z.email({ error: "Enter a valid email address." }));

const loginPasswordSchema = z
  .string({ error: "Password must be a string." })
  .min(1, { error: "Password is required." })
  .refine(
    (password) =>
      Buffer.byteLength(password, "utf8") <= MAX_PASSWORD_BYTES,
    {
      error: `Password must not exceed ${MAX_PASSWORD_BYTES} UTF-8 bytes.`,
    }
  );

const newPasswordSchema = loginPasswordSchema.refine(
  (password) => Array.from(password).length >= MIN_PASSWORD_LENGTH,
  {
    error: `Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`,
  }
);

const loginSchema = z.strictObject({
  email: emailSchema,
  password: loginPasswordSchema,
});

const changePasswordSchema = z
  .strictObject({
    currentPassword: loginPasswordSchema,
    newPassword: newPasswordSchema,
  })
  .refine(
    (data) => data.newPassword !== data.currentPassword,
    {
      error: "New password must differ from the current password.",
      path: ["newPassword"],
    }
  );

module.exports = {
  emailSchema,
  newPasswordSchema,
  loginSchema,
  changePasswordSchema,
};