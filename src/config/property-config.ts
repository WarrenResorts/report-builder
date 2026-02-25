/**
 * @fileoverview Property Configuration Service
 *
 * Manages property-specific configuration for NetSuite integration including
 * subsidiary IDs, location IDs, and corporate names.
 */

import { createCorrelatedLogger } from "../utils/logger";

/**
 * Property configuration for NetSuite integration
 */
export interface PropertyConfig {
  /** Property name as it appears in reports */
  propertyName: string;
  /** NetSuite Location Internal ID */
  locationInternalId: string;
  /** NetSuite Subsidiary Internal ID */
  subsidiaryInternalId: string;
  /** Full subsidiary/corporation name */
  subsidiaryFullName: string;
  /** Short location name for display */
  locationName: string;
  /** Cash account code for credit card deposits (e.g., "10070-696") */
  creditCardDepositAccount: string;
}

/**
 * Property configuration database
 *
 * Contains all property-specific NetSuite configuration data.
 * Data provided by hotel accounting team.
 */
const PROPERTY_CONFIGURATIONS: PropertyConfig[] = [
  {
    propertyName: "THE BARD'S INN HOTEL",
    locationInternalId: "24",
    subsidiaryInternalId: "26",
    subsidiaryFullName: "THE BARD'S INN HOTEL",
    locationName: "Bard's Inn",
    creditCardDepositAccount: "10070-696",
  },
  {
    propertyName: "Crown City Inn",
    locationInternalId: "20",
    subsidiaryInternalId: "35",
    subsidiaryFullName: "Crown City Inn",
    locationName: "Crown City Inn",
    creditCardDepositAccount: "10130-715",
  },
  {
    propertyName: "Driftwood Inn",
    locationInternalId: "3",
    subsidiaryInternalId: "3",
    subsidiaryFullName: "Driftwood Inn",
    locationName: "Driftwood Inn",
    creditCardDepositAccount: "10050-535",
  },
  {
    propertyName: "El Bonita Motel",
    locationInternalId: "18",
    subsidiaryInternalId: "22",
    subsidiaryFullName: "El Bonita Motel",
    locationName: "El Bonita Motel",
    creditCardDepositAccount: "10172-755",
  },
  {
    propertyName: "LAKESIDE LODGE AND SUITES",
    locationInternalId: "19",
    subsidiaryInternalId: "16",
    subsidiaryFullName: "LAKESIDE LODGE AND SUITES",
    locationName: "Lakeside Lodge and Suites",
    creditCardDepositAccount: "10210-678",
  },
  {
    propertyName: "MARINA BEACH MOTEL",
    locationInternalId: "4",
    subsidiaryInternalId: "5",
    subsidiaryFullName: "MARINA BEACH MOTEL",
    locationName: "Marina Beach Motel",
    creditCardDepositAccount: "10010-528",
  },
  {
    propertyName: "BW Plus PONDERAY MOUNTAIN LODGE",
    locationInternalId: "17",
    subsidiaryInternalId: "12",
    subsidiaryFullName: "BW Plus PONDERAY MOUNTAIN LODGE",
    locationName: "BW Plus Ponderay Mountain Lodge",
    creditCardDepositAccount: "10230-681",
  },
  {
    propertyName: "Best Western Sawtooth Inn & Suites",
    locationInternalId: "16",
    subsidiaryInternalId: "14",
    subsidiaryFullName: "Best Western Sawtooth Inn & Suites",
    locationName: "Best Western Sawtooth Inn & Suites",
    creditCardDepositAccount: "10250-684",
  },
  {
    propertyName: "Best Western University Lodge",
    locationInternalId: "14",
    subsidiaryInternalId: "20",
    subsidiaryFullName: "Best Western University Lodge",
    locationName: "Best Western University Lodge",
    creditCardDepositAccount: "10270-687",
  },
  {
    propertyName: "THE VINE INN",
    locationInternalId: "15",
    subsidiaryInternalId: "18",
    subsidiaryFullName: "THE VINE INN",
    locationName: "The Vine Inn",
    creditCardDepositAccount: "10150-675",
  },
  {
    propertyName: "Best Western Windsor Inn",
    locationInternalId: "25",
    subsidiaryInternalId: "24",
    subsidiaryFullName: "Best Western Windsor Inn",
    locationName: "Best Western Windsor Inn",
    creditCardDepositAccount: "10290-707",
  },
];

/**
 * Property Configuration Service
 *
 * Provides lookup and management of property-specific configuration data
 * required for NetSuite CSV generation.
 */
export class PropertyConfigService {
  private configMap: Map<string, PropertyConfig>;
  private logger = createCorrelatedLogger("PropertyConfigService");

  constructor() {
    this.configMap = new Map();
    this.initializeConfigMap();
  }

  /**
   * Initialize the configuration map with property data
   */
  private initializeConfigMap(): void {
    for (const config of PROPERTY_CONFIGURATIONS) {
      // Normalize property name for lookup (uppercase, trim)
      const normalizedName = this.normalizePropertyName(config.propertyName);
      this.configMap.set(normalizedName, config);
    }

    this.logger.info("Property configuration initialized", {
      totalProperties: this.configMap.size,
      properties: Array.from(this.configMap.keys()),
    });
  }

  /**
   * Normalize property name for consistent lookup
   */
  private normalizePropertyName(name: string): string {
    return name.toUpperCase().trim();
  }

  /**
   * Get configuration for a specific property
   *
   * @param propertyName - Property name as it appears in reports
   * @returns Property configuration or null if not found
   */
  public getPropertyConfig(propertyName: string): PropertyConfig | null {
    const normalizedName = this.normalizePropertyName(propertyName);
    const config = this.configMap.get(normalizedName);

    if (!config) {
      this.logger.warn("Property configuration not found", {
        propertyName,
        normalizedName,
        availableProperties: Array.from(this.configMap.keys()),
      });
      return null;
    }

    return config;
  }

  /**
   * Get all configured properties
   *
   * @returns Array of all property configurations
   */
  public getAllProperties(): PropertyConfig[] {
    return Array.from(this.configMap.values());
  }

  /**
   * Check if a property is configured
   *
   * @param propertyName - Property name to check
   * @returns True if property has configuration
   */
  public hasProperty(propertyName: string): boolean {
    const normalizedName = this.normalizePropertyName(propertyName);
    return this.configMap.has(normalizedName);
  }

  /**
   * Add or update a property configuration
   * Useful for dynamic configuration updates
   *
   * @param config - Property configuration to add/update
   */
  public setPropertyConfig(config: PropertyConfig): void {
    const normalizedName = this.normalizePropertyName(config.propertyName);
    this.configMap.set(normalizedName, config);

    this.logger.info("Property configuration updated", {
      propertyName: config.propertyName,
      locationId: config.locationInternalId,
      subsidiaryId: config.subsidiaryInternalId,
    });
  }

  /**
   * Get default/fallback configuration for unconfigured properties
   * Uses generic values that should be replaced with actual data
   *
   * @param propertyName - Property name for logging
   * @returns Default configuration
   */
  public getDefaultConfig(propertyName: string): PropertyConfig {
    this.logger.warn("Using default configuration for unconfigured property", {
      propertyName,
      warning:
        "This property needs to be added to property-config.ts with actual NetSuite IDs",
    });

    return {
      propertyName,
      locationInternalId: "1", // Default location
      subsidiaryInternalId: "5", // Default subsidiary
      subsidiaryFullName:
        "Parent Company : Warren Family Hotels : Warren Resort Hotels, Inc.",
      locationName: propertyName,
      creditCardDepositAccount: "10010-528", // Default cash account
    };
  }

  /**
   * Get configuration with fallback to default
   * This ensures processing can continue even for unconfigured properties
   *
   * @param propertyName - Property name
   * @returns Property configuration (actual or default)
   */
  public getPropertyConfigOrDefault(propertyName: string): PropertyConfig {
    return (
      this.getPropertyConfig(propertyName) ||
      this.getDefaultConfig(propertyName)
    );
  }
}

/**
 * Singleton instance of PropertyConfigService
 */
let propertyConfigServiceInstance: PropertyConfigService | null = null;

/**
 * Get the singleton PropertyConfigService instance
 */
export function getPropertyConfigService(): PropertyConfigService {
  if (!propertyConfigServiceInstance) {
    propertyConfigServiceInstance = new PropertyConfigService();
  }
  return propertyConfigServiceInstance;
}
