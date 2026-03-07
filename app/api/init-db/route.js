import { NextResponse } from 'next/server';
import { initializeDatabase } from '@/libs/schema';

export async function POST() {
  try {
    await initializeDatabase();
    
    return NextResponse.json({ 
      success: true, 
      message: 'Database initialized successfully' 
    });
  } catch (error) {
    console.error('Database initialization error:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Database initialization failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
