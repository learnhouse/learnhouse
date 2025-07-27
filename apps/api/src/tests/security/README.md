# Security Module Tests

This directory contains comprehensive unit tests for the security module of the LearnHouse API.

## Test Structure

The security tests are organized into the following files:

### Core Security Tests
- **`test_security.py`** - Tests for password hashing, JWT constants, and core security functions
- **`test_auth.py`** - Tests for JWT authentication, user authentication, and token management

### Role-Based Access Control (RBAC) Tests
- **`test_rbac.py`** - Tests for RBAC authorization functions and user permissions
- **`test_rbac_utils.py`** - Tests for RBAC utility functions like element type checking

### Feature Usage Tests
- **`test_features_utils.py`** - Tests for feature usage tracking and limits

### Comprehensive Tests
- **`test_security_all.py`** - Comprehensive test suite that imports and validates all security modules

## Test Coverage

### Security Core (`test_security.py`)
- ✅ Password hashing with `security_hash_password()`
- ✅ Password verification with `security_verify_password()`
- ✅ JWT constants validation
- ✅ Edge cases (special characters, unicode, long passwords)
- ✅ Password consistency and security

### Authentication (`test_auth.py`)
- ✅ JWT token creation and validation
- ✅ User authentication flow
- ✅ Anonymous user handling
- ✅ Token expiry and validation
- ✅ Error handling for invalid tokens
- ✅ Settings and configuration validation

### RBAC (`test_rbac.py`)
- ✅ Public element authorization
- ✅ User author verification
- ✅ Role-based permissions
- ✅ Organization admin status
- ✅ Combined roles and authorship
- ✅ Anonymous user restrictions

### RBAC Utils (`test_rbac_utils.py`)
- ✅ Element type detection for all supported types
- ✅ Singular form conversion
- ✅ ID identifier generation
- ✅ Edge cases and error handling
- ✅ Consistency validation

### Feature Usage (`test_features_utils.py`)
- ✅ Feature limit checking
- ✅ Usage tracking (increase/decrease)
- ✅ Redis integration
- ✅ Organization configuration validation
- ✅ Unlimited feature handling
- ✅ Error handling for missing configs

## Running the Tests

### Run All Security Tests
```bash
# From the project root
pytest src/tests/security/ -v

# Run with coverage
pytest src/tests/security/ --cov=src.security --cov-report=html
```

### Run Specific Test Files
```bash
# Run only core security tests
pytest src/tests/security/test_security.py -v

# Run only authentication tests
pytest src/tests/security/test_auth.py -v

# Run only RBAC tests
pytest src/tests/security/test_rbac.py -v

# Run only feature usage tests
pytest src/tests/security/test_features_utils.py -v
```

### Run Comprehensive Tests
```bash
# Run the comprehensive test suite
pytest src/tests/security/test_security_all.py -v
```

## Test Dependencies

The tests use the following dependencies:
- `pytest` - Testing framework
- `pytest-asyncio` - Async test support
- `unittest.mock` - Mocking and patching
- `fastapi` - HTTP exception testing
- `sqlmodel` - Database session mocking

## Mock Strategy

The tests use comprehensive mocking to isolate the security functionality:

1. **Database Sessions** - Mocked to avoid actual database connections
2. **Redis Connections** - Mocked to avoid actual Redis dependencies
3. **External Services** - Mocked to test error conditions
4. **Configuration** - Mocked to test different config scenarios

## Test Patterns

### Async Testing
All async functions are properly tested with `@pytest.mark.asyncio` decorators.

### Error Handling
Tests verify that appropriate HTTP exceptions are raised with correct status codes and messages.

### Edge Cases
Tests cover edge cases like:
- Empty or null values
- Invalid UUIDs
- Disabled features
- Missing configurations
- Network failures

### Type Safety
Tests ensure type safety by using proper type annotations and handling type checking errors.

## Adding New Tests

When adding new security functionality:

1. **Create a new test file** following the naming convention `test_<module_name>.py`
2. **Add comprehensive test cases** covering success, failure, and edge cases
3. **Use proper mocking** to isolate the functionality being tested
4. **Add async support** if the function is async
5. **Update this README** to document the new tests

## Test Data

The tests use mock data that represents realistic scenarios:
- Mock users with different permission levels
- Mock organizations with various configurations
- Mock resources with different access patterns
- Mock Redis usage data

## Continuous Integration

These tests are designed to run in CI/CD pipelines and provide:
- Fast execution (no real database/Redis connections)
- Comprehensive coverage of security functionality
- Clear error messages for debugging
- Reliable results across different environments

## Security Considerations

The tests are designed to validate security without exposing sensitive information:
- No real passwords or tokens in test data
- Mocked authentication flows
- Isolated testing of security functions
- No actual encryption/decryption of sensitive data

## Contributing

When contributing to security tests:

1. Follow the existing patterns and conventions
2. Ensure all edge cases are covered
3. Use descriptive test names and docstrings
4. Add appropriate error handling tests
5. Update documentation as needed 