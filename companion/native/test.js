#!/usr/bin/env node

/**
 * Simple test script for native module
 * Verifies all functions work correctly
 */

const native = require('./index.js');

console.log('🧪 Testing Cursor Telemetry Native Module\n');

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result === true || (result && result.success !== false)) {
      console.log(`✅ ${name}`);
      testsPassed++;
    } else {
      console.log(`❌ ${name}: ${result.error || 'Failed'}`);
      testsFailed++;
    }
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    testsFailed++;
  }
}

// Test 1: calculateDiff
test('calculateDiff - basic diff', () => {
  const result = native.calculateDiff('hello', 'hello world');
  return result.diffSize === 6 && result.linesAdded >= 0;
});

// Test 2: calculateDiff - with threshold
test('calculateDiff - threshold check', () => {
  const result = native.calculateDiff('a', 'b', 10);
  return result.isSignificant === false;
});

// Test 3: getLineChanges
test('getLineChanges - line changes', () => {
  const result = native.getLineChanges('line1\nline2', 'line1\nline2\nline3');
  return Array.isArray(result);
});

// Test 4: calculateFileStats
test('calculateFileStats - file statistics', () => {
  const content = 'hello\nworld\n\n// comment';
  const result = native.calculateFileStats(content);
  return result.lines === 4 && result.chars === content.length;
});

// Test 5: batchCalculateDiffs
test('batchCalculateDiffs - batch processing', () => {
  const pairs = [
    ['old1', 'new1'],
    ['old2', 'new2'],
  ];
  const results = native.batchCalculateDiffs(pairs);
  return results.length === 2;
});

// Test 6: searchPatterns
test('searchPatterns - pattern matching', () => {
  const content = 'hello world hello';
  const patterns = ['hello', 'world'];
  const result = native.searchPatterns(content, patterns);
  return result.hello === 2 && result.world === 1;
});

// Test 7: detectLanguage - by filename
test('detectLanguage - by filename', () => {
  const result = native.detectLanguage('', 'test.rs');
  return result === 'rust';
});

// Test 8: detectLanguage - by content
test('detectLanguage - by content', () => {
  const result = native.detectLanguage('fn main() { }');
  return result === 'rust';
});

// Test 9: calculateSimilarity
test('calculateSimilarity - similarity ratio', () => {
  const result = native.calculateSimilarity('hello', 'hello');
  return result === 1.0;
});

// Test 10: extractFunctions - Rust
test('extractFunctions - Rust functions', () => {
  const code = 'fn main() {}\nfn helper() {}';
  const result = native.extractFunctions(code, 'rust');
  return result.length >= 2 && result.includes('main');
});

// Test 11: extractFunctions - JavaScript
test('extractFunctions - JavaScript functions', () => {
  const code = 'function test() {}\nconst helper = () => {}';
  const result = native.extractFunctions(code, 'javascript');
  return result.length >= 1;
});

// Test 12: deduplicateStrings
test('deduplicateStrings - deduplication', () => {
  const strings = ['a', 'b', 'a', 'c', 'b'];
  const result = native.deduplicateStrings(strings);
  return (
    result.length === 3 && result.includes('a') && result.includes('b') && result.includes('c')
  );
});

// Test 13: estimateTokens
test('estimateTokens - token estimation', () => {
  const result = native.estimateTokens('hello world');
  return typeof result === 'number' && result > 0;
});

console.log('\n📊 Test Results:');
console.log(`   ✅ Passed: ${testsPassed}`);
console.log(`   ❌ Failed: ${testsFailed}`);
console.log(`   📈 Total:  ${testsPassed + testsFailed}\n`);

if (testsFailed === 0) {
  console.log('🎉 All tests passed!');
  process.exit(0);
} else {
  console.log('⚠️  Some tests failed. Check the output above.');
  process.exit(1);
}
