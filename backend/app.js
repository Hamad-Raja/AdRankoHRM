require("dotenv/config");

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const prisma = require("./src/config/prisma");
const authRoutes = require("./routes/auth.routes");
const employeeRoutes = require("./routes/employee.routes");
const ApiError = require("./src/utils/ApiError");
const errorHandler = require("./src/middleware/errorHandler");

const {
  ALLOWED_ORIGINS,
  CSRF_HEADER_NAME,
} = require("./src/config/auth");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

app.disable("x-powered-by");

app.use(helmet());

app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", CSRF_HEADER_NAME],
    exposedHeaders: ["Content-Disposition"],
  })
);

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.get("/api/health", (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  res.status(200).json({
    success: true,
    service: "OfficeHR API",
    status: "ok",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/shifts", require("./routes/shift.routes"));
app.use("/api/attendance-settings", require("./routes/attendance-settings.routes"));
app.use("/api/organization", require("./routes/organization.routes"));
app.use("/api/employee-files", require("./routes/employee-document.routes"));
app.use("/api/attendance", require("./routes/attendance.routes"));
app.use("/api/reports", require("./routes/reports.routes"));
app.use("/api/payroll", require("./routes/payroll.routes"));
app.use("/api/announcements", require("./routes/announcement.routes"));
app.use("/api/notifications", require("./routes/notification.routes"));
app.use("/api/leaves", require("./routes/leave.routes"));
app.use("/api/dashboard", require("./routes/dashboard.routes"));

app.use((req, res, next) => {
  next(new ApiError(404, "Endpoint not found.", "NOT_FOUND"));
});

app.use(errorHandler);

let server;
let isShuttingDown = false;

async function shutdown(reason, exitCode = 0) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  console.log(`${reason}. Stopping OfficeHR API...`);

  const shutdownTimer = setTimeout(() => {
    console.error("Shutdown timed out.");
    process.exit(1);
  }, 10_000);

  shutdownTimer.unref();

  try {
    if (server && server.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }

    await prisma.$disconnect();

    console.log("Database disconnected.");
    console.log("OfficeHR API stopped.");
  } catch (error) {
    console.error("Shutdown failed:", error.message);
    exitCode = 1;
  } finally {
    clearTimeout(shutdownTimer);
    process.exit(exitCode);
  }
}

async function startServer() {
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;

    if (isShuttingDown) {
      return;
    }

    console.log("Database connection verified.");

    server = app.listen(PORT, HOST, () => {
      console.log(`OfficeHR API running at http://${HOST}:${PORT}`);
    });

    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use.`);
      } else {
        console.error("HTTP server failed:", error.message);
      }

      void shutdown("HTTP server failure", 1);
    });
  } catch (error) {
    console.error("Startup failed:", error.message);
    await shutdown("Startup failure", 1);
  }
}

// Importing the app for tests must not start a listener.
if (require.main === module) {
  process.once("SIGINT", () => {
    void shutdown("SIGINT received");
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM received");
  });

  void startServer();
}

module.exports = app;
