# ADR-007: TypeScript as Primary Language

## Status
Accepted

## Context

The Report Builder system requires a programming language for:

- **Lambda function development**: Core business logic for email and file processing
- **Infrastructure as Code**: CDK requires a programming language for infrastructure definition
- **Configuration management**: Type-safe configuration handling across environments
- **Developer productivity**: Strong tooling support for large codebases
- **Maintainability**: Clear interfaces and compile-time error detection
- **Team skills**: Leverage existing JavaScript/TypeScript expertise
- **AWS SDK integration**: Comprehensive AWS service integration

## Decision

We will use **TypeScript** as the primary programming language for all application code, infrastructure code, and configuration management.

## Alternatives Considered

### 1. JavaScript (Node.js)
- **Pros**: No compilation step, familiar to team, rapid prototyping, smaller runtime footprint
- **Cons**: No compile-time type checking, harder to refactor, prone to runtime errors, limited IDE support

### 2. Python
- **Pros**: Excellent AWS SDK, rich data processing libraries, readable syntax, strong community
- **Cons**: Runtime type errors, slower cold starts, larger deployment packages, different skillset required

### 3. Java
- **Pros**: Strong typing, excellent performance, mature ecosystem, enterprise adoption
- **Cons**: Verbose syntax, slow cold starts, large deployment packages, steeper learning curve

### 4. C# (.NET)
- **Pros**: Strong typing, good performance, familiar to enterprise developers
- **Cons**: Windows-centric ecosystem, less AWS Lambda optimization, additional learning curve

### 5. Go
- **Pros**: Fast performance, small binaries, excellent concurrency, growing AWS support
- **Cons**: Different paradigms from existing skills, smaller ecosystem, learning curve

## Consequences

### Positive
- **Compile-time safety**: Type checking catches errors before deployment
- **Excellent IDE support**: IntelliSense, refactoring, debugging with VS Code/IntelliJ
- **AWS SDK quality**: First-class TypeScript support with comprehensive type definitions
- **Code maintainability**: Self-documenting interfaces and clear contract definitions
- **Refactoring confidence**: Type system enables safe large-scale code changes
- **Team productivity**: Leverages existing JavaScript knowledge with added type safety
- **Package ecosystem**: Access to entire npm ecosystem with type safety
- **Infrastructure consistency**: Same language for application and infrastructure code

### Negative
- **Compilation overhead**: Build step required before deployment
- **Learning curve**: TypeScript-specific concepts (generics, advanced types, decorators)
- **Configuration complexity**: tsconfig.json and build tool configuration required
- **Runtime overhead**: Minimal, but compilation artifacts can be larger than raw JavaScript

### Neutral
- **Cold start performance**: Comparable to JavaScript, faster than Python/Java
- **Memory usage**: Similar to JavaScript with minor overhead for type information
- **Deployment size**: Slightly larger than JavaScript due to compilation artifacts

## Implementation Notes

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "**/*.test.ts", "**/*.d.ts"]
}
```

### Type Safety Implementation
- **Strict mode enabled**: No implicit any, null checks, strict function types
- **Interface definitions**: Clear contracts for all data structures
- **Generic types**: Reusable type-safe functions and classes
- **Enum usage**: Type-safe constants and configuration options
- **AWS SDK types**: Leveraging @aws-sdk type definitions

### Code Organization
```
src/
├── types/                 # Centralized type definitions
│   ├── environment.ts     # Environment configuration types
│   ├── parameter-store.ts # Parameter Store configuration types
│   ├── lambda.ts         # Lambda function interfaces
│   └── errors.ts         # Error handling types
├── config/               # Configuration management
├── lambda/               # Lambda function implementations
├── utils/                # Utility functions and helpers
└── index.ts             # Application entry point
```

### Development Workflow
- **Compile-time checking**: `npm run build` validates all TypeScript
- **Live development**: `npm run watch` for continuous compilation
- **Testing**: Vitest with TypeScript support for type-safe tests
- **Linting**: ESLint with TypeScript rules for code quality
- **IDE integration**: Full IntelliSense and error checking

### AWS Lambda Integration
- **Lambda handlers**: Type-safe event and context handling
- **AWS SDK v3**: Modern TypeScript-first SDK with tree-shaking
- **Environment variables**: Type-safe environment configuration
- **Error handling**: Structured error types with proper inheritance

### Infrastructure Benefits
- **CDK constructs**: Type-safe infrastructure definition
- **Configuration validation**: Compile-time validation of environment settings
- **Resource references**: Type-safe resource ARN and name handling
- **Deployment safety**: Catch configuration errors before AWS deployment

### Performance Considerations
- **Bundle optimization**: Tree-shaking removes unused code
- **Cold start optimization**: Minimal runtime overhead compared to JavaScript
- **Memory efficiency**: Type information stripped at runtime
- **Build optimization**: Production builds optimized for size and performance

## References
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [AWS Lambda TypeScript Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/typescript-handler.html)
- [TypeScript Node.js Starter](https://github.com/microsoft/TypeScript-Node-Starter) 