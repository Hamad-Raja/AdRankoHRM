require("dotenv/config");

const prisma = require("../src/config/prisma");
const { hashPassword } = require("../src/utils/password");
const {
  emailSchema,
  newPasswordSchema,
} = require("../src/validation/auth.validation");

class SetupError extends Error {}

function validateWith(schema, value) {
  const result = schema.safeParse(value);

  return result.success
    ? true
    : result.error.issues[0].message;
}

async function createAdmin() {
  try {
    await prisma.$connect();

    const existingAdmin = await prisma.user.findFirst({
      where: { role: "ADMIN" },
      select: { id: true },
    });

    if (existingAdmin) {
      console.log("An Admin account already exists. No changes were made.");
      return;
    }

    const { input, password } = await import("@inquirer/prompts");

    const displayName = (
      await input({
        message: "Admin display name:",
        validate(value) {
          const length = Array.from(value.trim()).length;

          return (
            (length >= 1 && length <= 120) ||
            "Enter a name between 1 and 120 characters."
          );
        },
      })
    ).trim();

    const email = emailSchema.parse(
      await input({
        message: "Admin email:",
        validate: (value) => validateWith(emailSchema, value),
      })
    );

    const plainPassword = await password({
      message: "Admin password:",
      mask: true,
      validate: (value) => validateWith(newPasswordSchema, value),
    });

    await password({
      message: "Confirm password:",
      mask: true,
      validate: (value) =>
        value === plainPassword || "Passwords do not match.",
    });

    const passwordHash = await hashPassword(plainPassword);

    const admin = await prisma.$transaction(
      async (tx) => {
        // Check again inside the transaction before creating an Admin.
        const adminExists = await tx.user.findFirst({
          where: { role: "ADMIN" },
          select: { id: true },
        });

        if (adminExists) {
          throw new SetupError(
            "An Admin account already exists. No changes were made."
          );
        }

        const emailExists = await tx.user.findUnique({
          where: { email },
          select: { id: true },
        });

        if (emailExists) {
          throw new SetupError(
            "This email belongs to an existing account. No changes were made."
          );
        }

        const user = await tx.user.create({
          data: {
            displayName,
            email,
            passwordHash,
            role: "ADMIN",
            status: "ACTIVE",
            mustChangePassword: false,
          },
          select: {
            id: true,
            email: true,
            role: true,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            action: "ADMIN_BOOTSTRAPPED",
            success: true,
            targetType: "User",
            targetId: user.id,
            metadata: {
              source: "create-admin-script",
            },
          },
        });

        return user;
      },
      {
        isolationLevel: "Serializable",
      }
    );

    console.log("Admin account created successfully.");
    console.log("Email:", admin.email);
    console.log("Role:", admin.role);
  } catch (error) {
    if (error.name === "ExitPromptError") {
      console.log("Admin setup cancelled.");
      return;
    }

    process.exitCode = 1;

    if (error instanceof SetupError) {
      console.error(error.message);
    } else if (error.code === "P2002") {
      console.error("This email is already registered.");
    } else if (error.code === "P2034") {
      console.error("Concurrent database change detected. Run setup again.");
    } else {
      // Do not print credentials or database query contents.
      console.error("Admin setup failed. Check the database connection.");
      console.error("Error code:", error.code || error.name || "UNKNOWN");
    }
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin().catch(() => {
  console.error("Unable to finish Admin setup cleanly.");
  process.exitCode = 1;
});