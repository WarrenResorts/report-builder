import { describe, it, expect, vi } from 'vitest';

describe('Index', () => {
  it('should log startup messages', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    
    // Import the module to trigger the console.log statements
    await import('./index');
    
    expect(consoleSpy).toHaveBeenCalledWith('🚀 Report Builder starting...');
    expect(consoleSpy).toHaveBeenCalledWith('Environment: test');
    expect(consoleSpy).toHaveBeenCalledWith('AWS Region: us-east-1');
    
    consoleSpy.mockRestore();
  });
}); 