import { describe, it, expect, vi } from 'vitest';

/**
 * Test Suite: Index Module
 * 
 * This test suite validates the main application entry point (index.js),
 * ensuring it properly initializes and displays startup information.
 * 
 * The index module serves as:
 * - Application entry point for local development and testing
 * - Environment configuration validation checkpoint
 * - Startup logging for debugging and monitoring
 * - Future home for CLI commands and development utilities
 * 
 * Test Coverage Areas:
 * - Startup message logging validation
 * - Environment configuration display
 * - Console output verification
 * - Module import behavior
 * 
 * This ensures the application starts correctly and provides
 * clear feedback about its configuration state.
 */
describe('Index', () => {
  it('should log startup messages using structured logging', async () => {
    const consoleInfoSpy = vi.spyOn(console, 'info');
    
    // Import the module to trigger the structured logging
    await import('./index');
    
    // Verify structured logging was called with proper JSON format
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('"message":"Report Builder starting"')
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('"environment":"test"')
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('"awsRegion":"us-east-1"')
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining('"operation":"application_startup"')
    );
    
    consoleInfoSpy.mockRestore();
  });
}); 