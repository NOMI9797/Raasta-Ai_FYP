#!/usr/bin/env node

/**
 * Test script to manually trigger Redis pre-fetch
 * This will show you exactly when and how pre-fetch works
 */

const fetch = require('node-fetch');

async function testPreFetch() {
  console.log('🧪 TESTING REDIS PRE-FETCH');
  console.log('============================');
  
  try {
    console.log('📡 Calling pre-fetch API...');
    
    const response = await fetch('http://localhost:8085/api/redis-workflow/campaigns/pre-fetch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: 'test-user-123'
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    console.log('✅ Pre-fetch completed successfully!');
    console.log('📊 Result:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ Pre-fetch failed:', error.message);
  }
}

// Run the test
testPreFetch();
