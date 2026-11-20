// Hosting-provided values take precedence over local environment files.
require("dotenv").config({ override: false, quiet: true });
// Only ordinary executable startup loads the private opt-in file. Imported test
// apps/acceptance runners retain their explicitly supplied environment.
if (require.main === module && process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: require('node:path').join(__dirname, '.env.local'), override: false, quiet: true });
}
const localDemoConfig = require('./src/config/local-demo').readLocalDemoConfig();

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
const HOST = process.env.NODE_ENV === "production" ? "0.0.0.0" : process.env.HOST || "127.0.0.1";

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

// Time only the affected attendance reads, including authentication. Never log
// request bodies, query parameters, headers or account identifiers.
app.use((req, res, next) => {
  if (req.method === 'GET' && /^\/api\/(attendance\/status|attendance-settings(?:\/my-shift)?)\/?$/.test(req.path)) {
    req.attendanceReadStartedAt = performance.now();
  }
  next();
});

app.get("/api/health", (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  res.status(200).json({
    success: true,
    service: "OfficeHR API",
    status: "ok",
  });
});

if (localDemoConfig.enabled) {
  app.use('/api/auth', require('./routes/local-demo.routes').createLocalDemoRouter({ config: localDemoConfig, prisma }));
}
app.use("/api/auth", authRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/employee-records", require("./routes/employee-record.routes"));
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
app.use("/api/audit", require("./routes/audit.routes"));
app.use("/api/employment", require("./routes/employment.routes"));

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
    // Auth/login also enforce approved cutoffs synchronously. This worker is
    // supplementary and never runs merely from importing the app in tests.
    const lifecycleTimer=setInterval(()=>void require('./src/services/employment-access.service').processDue().catch(()=>console.error('Lifecycle worker unavailable.')),60000);
    lifecycleTimer.unref();

    server = app.listen(PORT, HOST, (error) => {
      // Express 5 also invokes this callback on a listen failure.
      // The server error listener below owns logging and cleanup in that case.
      if (error) return;
      const address = server.address();
      const boundHost = address.family === 'IPv6' ? `[${address.address}]` : address.address;
      console.log(`OfficeHR API running at http://${boundHost}:${address.port}`);
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
