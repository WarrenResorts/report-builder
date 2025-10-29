import { describe, it, expect, beforeEach } from "vitest";
import { PropertyConfigService } from "./property-config";

describe("PropertyConfigService", () => {
  let service: PropertyConfigService;

  beforeEach(() => {
    service = new PropertyConfigService();
  });

  describe("getPropertyConfig", () => {
    it("should return config for known property", () => {
      const config = service.getPropertyConfig("THE BARD'S INN HOTEL");
      expect(config).toBeDefined();
      expect(config?.propertyName).toBe("THE BARD'S INN HOTEL");
      expect(config?.locationInternalId).toBe("24");
    });

    it("should return config case-insensitively", () => {
      const config = service.getPropertyConfig("the bard's inn hotel");
      expect(config).toBeDefined();
      expect(config?.propertyName).toBe("THE BARD'S INN HOTEL");
    });

    it("should return null for unknown property", () => {
      const config = service.getPropertyConfig("Unknown Hotel");
      expect(config).toBeNull();
    });
  });

  describe("getDefaultConfig", () => {
    it("should return default config for unconfigured property", () => {
      const config = service.getDefaultConfig("New Property");
      expect(config).toBeDefined();
      expect(config.propertyName).toBe("New Property");
      expect(config.locationInternalId).toBe("1");
      expect(config.subsidiaryInternalId).toBe("5");
      expect(config.creditCardDepositAccount).toBe("10010-528");
    });
  });

  describe("getPropertyConfigOrDefault", () => {
    it("should return actual config for known property", () => {
      const config = service.getPropertyConfigOrDefault("THE BARD'S INN HOTEL");
      expect(config.propertyName).toBe("THE BARD'S INN HOTEL");
      expect(config.locationInternalId).toBe("24");
    });

    it("should return default config for unknown property", () => {
      const config = service.getPropertyConfigOrDefault("Unknown Hotel");
      expect(config.propertyName).toBe("Unknown Hotel");
      expect(config.locationInternalId).toBe("1");
    });
  });

  describe("getAllProperties", () => {
    it("should return list of all configured properties", () => {
      const properties = service.getAllProperties();
      expect(properties).toBeDefined();
      expect(Array.isArray(properties)).toBe(true);
      expect(properties.length).toBeGreaterThan(0);
      // getAllProperties returns PropertyConfig objects, not names
      const propertyNames = properties.map((p) => p.propertyName);
      expect(propertyNames).toContain("THE BARD'S INN HOTEL");
    });
  });

  describe("hasProperty", () => {
    it("should return true for configured property", () => {
      expect(service.hasProperty("THE BARD'S INN HOTEL")).toBe(true);
      expect(service.hasProperty("the bard's inn hotel")).toBe(true); // Case insensitive
    });

    it("should return false for unconfigured property", () => {
      expect(service.hasProperty("Unknown Hotel")).toBe(false);
    });
  });

  describe("setPropertyConfig", () => {
    it("should add new property configuration", () => {
      const newConfig = {
        propertyName: "Test Hotel",
        locationInternalId: "999",
        subsidiaryInternalId: "888",
        subsidiaryFullName: "Test Subsidiary",
        locationName: "Test Location",
        creditCardDepositAccount: "10000-000",
      };

      service.setPropertyConfig(newConfig);

      const config = service.getPropertyConfig("Test Hotel");
      expect(config).toBeDefined();
      expect(config?.locationInternalId).toBe("999");
    });

    it("should update existing property configuration", () => {
      const updatedConfig = {
        propertyName: "THE BARD'S INN HOTEL",
        locationInternalId: "999",
        subsidiaryInternalId: "888",
        subsidiaryFullName: "Updated Sub",
        locationName: "Updated Location",
        creditCardDepositAccount: "10000-000",
      };

      service.setPropertyConfig(updatedConfig);

      const config = service.getPropertyConfig("THE BARD'S INN HOTEL");
      expect(config).toBeDefined();
      expect(config?.locationInternalId).toBe("999");
    });
  });
});
