#!/usr/bin/env node

/**
 * MCP Search & Optimization Test Suite
 * Tests all new features: search tools, database optimizations, visualizations
 */

const http = require('http');

const BASE_URL = process.env.BASE_URL || 'http://localhost:43917';
const ENABLE_MCP = process.env.ENABLE_MCP === 'true';

class TestRunner {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.tests = [];
  }

  async request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, BASE_URL);
      const opts = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      };

      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode,
              data: JSON.parse(data)
            });
          } catch (e) {
            resolve({
              status: res.statusCode,
              data: data
            });
          }
        });
      });

      req.on('error', reject);

      if (options.body) {
        req.write(JSON.stringify(options.body));
      }

      req.end();
    });
  }

  async test(name, fn) {
    process.stdout.write(`  ${name}... `);
    try {
      await fn();
      console.log('✓ PASS');
      this.passed++;
    } catch (error) {
      console.log('✗ FAIL');
      console.log(`    ${error.message}`);
      this.failed++;
    }
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  async run() {
    console.log('\n🔍 MCP Search & Optimization Test Suite\n');

    // Test 1: Database Optimization
    console.log('Database Optimization Tests:');
    
    await this.test('Get optimization status', async () => {
      const res = await this.request('/api/optimize/status');
      this.assert(res.status === 200, `Expected 200, got ${res.status}`);
      this.assert(res.data.success, 'Expected success=true');
      this.assert(Array.isArray(res.data.indexes), 'Expected indexes array');
    });

    await this.test('Apply optimizations', async () => {
      const res = await this.request('/api/optimize/apply', { method: 'POST' });
      this.assert(res.status === 200, `Expected 200, got ${res.status}`);
      this.assert(res.data.success, 'Expected success=true');
    });

    await this.test('Get optimization metrics', async () => {
      const res = await this.request('/api/optimize/metrics');
      this.assert(res.status === 200, `Expected 200, got ${res.status}`);
      this.assert(res.data.success, 'Expected success=true');
    });

    // Test 2: Enhanced Analytics
    console.log('\nEnhanced Analytics Tests:');

    await this.test('Get activity over time', async () => {
      const res = await this.request('/api/analytics/activity-over-time?cutoff=2025-01-01');
      this.assert(res.status === 200, `Expected 200, got ${res.status}`);
      this.assert(res.data.success, 'Expected success=true');
      this.assert(Array.isArray(res.data.timeline), 'Expected timeline array');
    });

    await this.test('Get event types', async () => {
      const res = await this.request('/api/analytics/event-types');
      this.assert(res.status === 200, `Expected 200, got ${res.status}`);
      this.assert(res.data.success, 'Expected success=true');
      this.assert(Array.isArray(res.data.types), 'Expected types array');
    });

    await this.test('Get model usage', async () => {
      const res = await this.request('/api/analytics/model-usage');
      this.assert(res.status === 200, `Expected 200, got ${res.status}`);
      this.assert(res.data.success, 'Expected success=true');
    });

    await this.test('Get activity heatmap', async () => {
      const res = await this.request('/api/analytics/activity-heatmap');
      this.assert(res.status === 200, `Expected 200, got ${res.status}`);
      this.assert(res.data.success, 'Expected success=true');
      this.assert(Array.isArray(res.data.by_day), 'Expected by_day array');
      this.assert(res.data.by_day.length === 7, 'Expected 7 days');
    });

    await this.test('Get workflow patterns', async () => {
      const res = await this.request('/api/analytics/patterns?limit=5');
      this.assert(res.status === 200, `Expected 200, got ${res.status}`);
      this.assert(res.data.success, 'Expected success=true');
      this.assert(Array.isArray(res.data.patterns), 'Expected patterns array');
    });

    await this.test('Get productivity metrics', async () => {
      const res = await this.request('/api/analytics/productivity');
      this.assert(res.status === 200, `Expected 200, got ${res.status}`);
      this.assert(res.data.success, 'Expected success=true');
      this.assert(typeof res.data.total_sessions === 'number', 'Expected total_sessions number');
    });

    await this.test('Get file network', async () => {
      const res = await this.request('/api/analytics/file-network?limit=20');
      this.assert(res.status === 200, `Expected 200, got ${res.status}`);
      this.assert(res.data.success, 'Expected success=true');
      this.assert(Array.isArray(res.data.nodes), 'Expected nodes array');
      this.assert(Array.isArray(res.data.links), 'Expected links array');
    });

    await this.test('Get recent activity', async () => {
      const res = await this.request('/api/analytics/recent-activity?limit=10');
      this.assert(res.status === 200, `Expected 200, got ${res.status}`);
      this.assert(res.data.success, 'Expected success=true');
      this.assert(Array.isArray(res.data.activities), 'Expected activities array');
    });

    await this.test('Get workspaces', async () => {
      const res = await this.request('/api/workspaces');
      this.assert(res.status === 200, `Expected 200, got ${res.status}`);
      this.assert(res.data.success, 'Expected success=true');
      this.assert(Array.isArray(res.data.workspaces), 'Expected workspaces array');
    });

    await this.test('Get overall stats', async () => {
      const res = await this.request('/api/stats');
      this.assert(res.status === 200, `Expected 200, got ${res.status}`);
      this.assert(res.data.success, 'Expected success=true');
      this.assert(typeof res.data.total_events === 'number', 'Expected total_events');
    });

    // Test 3: MCP Search (only if enabled)
    if (ENABLE_MCP) {
      console.log('\nMCP Search Tests:');

      await this.test('Get MCP capabilities', async () => {
        const res = await this.request('/mcp/capabilities');
        this.assert(res.status === 200, `Expected 200, got ${res.status}`);
        this.assert(res.data.success, 'Expected success=true');
        this.assert(res.data.capabilities, 'Expected capabilities object');
        this.assert(res.data.capabilities.read, 'Expected read capabilities');
        this.assert(res.data.capabilities.write, 'Expected write capabilities');
      });

      await this.test('Search workflows', async () => {
        const res = await this.request('/mcp/search-workflows', {
          method: 'POST',
          body: {
            query: 'test query',
            rung: 'semantic_edits',
            limit: 5
          }
        });
        this.assert(res.status === 200, `Expected 200, got ${res.status}`);
        this.assert(res.data.success, 'Expected success=true');
        this.assert(Array.isArray(res.data.matches), 'Expected matches array');
      });

      await this.test('Retrieve similar sessions', async () => {
        const res = await this.request('/mcp/retrieve-similar', {
          method: 'POST',
          body: {
            current_files: ['test.js'],
            rung: 'semantic_edits'
          }
        });
        this.assert(res.status === 200, `Expected 200, got ${res.status}`);
        this.assert(res.data.success, 'Expected success=true');
        this.assert(Array.isArray(res.data.matches), 'Expected matches array');
      });

      await this.test('Get workflow pattern', async () => {
        const res = await this.request('/mcp/workflow-pattern', {
          method: 'POST',
          body: {
            task_type: 'debugging'
          }
        });
        this.assert(res.status === 200, `Expected 200, got ${res.status}`);
        this.assert(res.data.success, 'Expected success=true');
      });

      await this.test('Query by intent', async () => {
        const res = await this.request('/mcp/query-intent', {
          method: 'POST',
          body: {
            intent: 'fix'
          }
        });
        this.assert(res.status === 200, `Expected 200, got ${res.status}`);
        this.assert(res.data.success, 'Expected success=true');
      });

    } else {
      console.log('\nMCP Search Tests: SKIPPED (MCP not enabled)');
      console.log('  Set ENABLE_MCP=true in environment or enable_mcp in config.json');
    }

    // Test 4: Dashboard Accessibility
    console.log('\nDashboard Accessibility Tests:');

    await this.test('MCP Search Dashboard accessible', async () => {
      const res = await this.request('/mcp-search-dashboard.html');
      this.assert(res.status === 200, `Expected 200, got ${res.status}`);
    });

    await this.test('Analytics Dashboard accessible', async () => {
      const res = await this.request('/analytics-viz.html');
      this.assert(res.status === 200, `Expected 200, got ${res.status}`);
    });

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log(`Total Tests: ${this.passed + this.failed}`);
    console.log(`✓ Passed: ${this.passed}`);
    console.log(`✗ Failed: ${this.failed}`);
    console.log('='.repeat(50));

    if (this.failed === 0) {
      console.log('\n🎉 All tests passed!\n');
      process.exit(0);
    } else {
      console.log('\n⚠️  Some tests failed.\n');
      process.exit(1);
    }
  }
}

// Run tests
const runner = new TestRunner();
runner.run().catch(err => {
  console.error('\n❌ Test suite error:', err);
  process.exit(1);
});



















