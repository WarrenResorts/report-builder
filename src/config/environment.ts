export interface EnvironmentConfig {
  environment: 'development' | 'production' | 'test';
  awsRegion: string;
  awsAccount: string;
}

const getEnvironmentConfig = (): EnvironmentConfig => {
  const environment = (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test';
  
  return {
    environment,
    awsRegion: process.env.AWS_REGION || 'us-east-1',
    awsAccount: process.env.AWS_ACCOUNT || '',
  };
};

export const config = getEnvironmentConfig();

// Backward compatibility alias
export const environment = config; 