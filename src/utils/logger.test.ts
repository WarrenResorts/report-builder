/**
 * @fileoverview Tests for Logger utility
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { Logger, LogLevel, createCorrelatedLogger } from "./logger";

describe("Logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("log levels", () => {
    it("should call console.debug for DEBUG level", () => {
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
      const logger = new Logger("TestService");
      logger.debug("debug message");
      expect(spy).toHaveBeenCalledOnce();
      const output = JSON.parse(spy.mock.calls[0][0] as string);
      expect(output.level).toBe("DEBUG");
      expect(output.message).toBe("debug message");
    });

    it("should call console.info for INFO level", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      const logger = new Logger("TestService");
      logger.info("info message");
      expect(spy).toHaveBeenCalledOnce();
      const output = JSON.parse(spy.mock.calls[0][0] as string);
      expect(output.level).toBe("INFO");
    });

    it("should call console.warn for WARN level", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const logger = new Logger("TestService");
      logger.warn("warn message");
      expect(spy).toHaveBeenCalledOnce();
      const output = JSON.parse(spy.mock.calls[0][0] as string);
      expect(output.level).toBe("WARN");
    });

    it("should call console.error for ERROR level", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const logger = new Logger("TestService");
      logger.error("error message");
      expect(spy).toHaveBeenCalledOnce();
      const output = JSON.parse(spy.mock.calls[0][0] as string);
      expect(output.level).toBe("ERROR");
    });

    it("should fall back to console.log for unrecognized log levels", () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const logger = new Logger("TestService");
      // Cast an unknown string to LogLevel to exercise the default branch
      logger["log"]("TRACE" as LogLevel, "trace message");
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  describe("child logger", () => {
    it("should create a child logger that inherits service name", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      const parent = new Logger("ParentService");
      const child = parent.child({ correlationId: "abc-123" });
      child.info("child message");
      const output = JSON.parse(spy.mock.calls[0][0] as string);
      expect(output.service).toBe("ParentService");
      expect(output.correlationId).toBe("abc-123");
    });

    it("should merge child context with parent default context", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      const parent = new Logger("ParentService", { operation: "parent-op" });
      const child = parent.child({ correlationId: "xyz" });
      child.info("merged message");
      const output = JSON.parse(spy.mock.calls[0][0] as string);
      expect(output.operation).toBe("parent-op");
      expect(output.correlationId).toBe("xyz");
    });
  });

  describe("log context", () => {
    it("should include additional context in log output", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      const logger = new Logger("TestService");
      logger.info("context message", { propertyId: "PROP001", count: 42 });
      const output = JSON.parse(spy.mock.calls[0][0] as string);
      expect(output.propertyId).toBe("PROP001");
      expect(output.count).toBe(42);
    });

    it("should include timestamp and service in every log entry", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      const logger = new Logger("MyService");
      logger.info("timestamp test");
      const output = JSON.parse(spy.mock.calls[0][0] as string);
      expect(output.timestamp).toBeDefined();
      expect(output.service).toBe("MyService");
    });
  });

  describe("createCorrelatedLogger", () => {
    it("should create a child logger with the given correlation ID in context", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      const correlatedLogger = createCorrelatedLogger("req-abc-123");
      correlatedLogger.info("correlated message");
      const output = JSON.parse(spy.mock.calls[0][0] as string);
      expect(output.correlationId).toBe("req-abc-123");
    });

    it("should include additional context when provided", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {});
      const correlatedLogger = createCorrelatedLogger("req-xyz", {
        propertyId: "PROP001",
      });
      correlatedLogger.info("additional context message");
      const output = JSON.parse(spy.mock.calls[0][0] as string);
      expect(output.correlationId).toBe("req-xyz");
      expect(output.propertyId).toBe("PROP001");
    });
  });
});
