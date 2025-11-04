# Test Suite for Obsidian Azure DevOps Plugin

This directory contains comprehensive tests for the Obsidian Azure DevOps Plugin.

## Test Structure

### Unit Tests
- **`api.test.ts`** - Tests for the AzureDevOpsAPI class
- **`work-item-manager.test.ts`** - Tests for the WorkItemManager class  
- **`link-validator.test.ts`** - Tests for the AzureDevOpsLinkValidator class

### Integration Tests
- **`integration.test.ts`** - End-to-end workflow tests

### Test Support Files
- **`setup.ts`** - Jest test environment setup
- **`__mocks__/obsidian.ts`** - Mock implementations of Obsidian API

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in watch mode
```bash
npm run test:watch
```

### Run tests with coverage report
```bash
npm run test:coverage
```

### Run tests for CI/CD
```bash
npm run test:ci
```

## Test Coverage

The test suite covers:

### Core API Functionality
- Work item creation, reading, updating
- Work item type management
- Relationship management (parent-child links)
- Custom field handling
- Error handling and validation

### Work Item Management
- Pull operations from Azure DevOps
- Push operations to Azure DevOps
- Note generation and parsing
- Content format conversion (HTML ↔ Markdown)
- File system operations

### Link Validation
- Azure DevOps link detection
- Work item link validation
- Batch validation of multiple files
- Error reporting

### Integration Scenarios
- End-to-end work item workflows
- Error handling across components
- Large dataset processing
- Settings updates

## Test Patterns

### Mocking
- Obsidian API is fully mocked
- Network requests are mocked using Jest
- File system operations are mocked

### Test Data
- Realistic work item structures
- Various link formats and edge cases
- Error scenarios and network failures

### Assertions
- Comprehensive validation of return values
- Proper error handling verification
- Mock call verification

## Best Practices

1. **Isolated Tests**: Each test is independent and can run in any order
2. **Descriptive Names**: Test names clearly describe what is being tested
3. **Arrange-Act-Assert**: Tests follow the AAA pattern
4. **Mock Cleanup**: Mocks are reset between tests
5. **Edge Cases**: Tests cover both happy path and error scenarios

## Contributing

When adding new features:

1. Write tests for new functionality
2. Ensure existing tests still pass
3. Maintain test coverage above 80%
4. Add integration tests for complex workflows
5. Update this README if new test categories are added