/**
 * Job Status SSE Stream (Redis Pub/Sub)
 * 
 * GET /api/jobs/[jobId]/stream
 * 
 * Server-Sent Events endpoint for real-time job progress updates.
 * Uses Redis Pub/Sub for instant updates, falls back to DB polling if Redis fails.
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/libs/auth-middleware";
import { db } from "@/libs/db";
import { workflowJobs } from "@/libs/schema";
import { eq, and } from "drizzle-orm";
import { createClient } from "redis";

export const GET = withAuth(async (request, { params, user }) => {
  try {
    const { jobId } = params;
    
    if (!jobId) {
      return NextResponse.json({ error: "Job ID is required" }, { status: 400 });
    }

    const jobRecord = await db.query.workflowJobs.findFirst({
      where: and(eq(workflowJobs.id, jobId), eq(workflowJobs.userId, user.id)),
    });

    if (!jobRecord) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const encoder = new TextEncoder();
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    
    // SSE stream for real-time progress
    const stream = new ReadableStream({
      async start(controller) {
        let redisSubscriber = null;
        let redisSnapshotClient = null;
        let pollInterval = null;
        let heartbeatInterval = null;
        let useRedis = false;
        let isClosed = false; // Track if controller is closed
        
        const sendEvent = (data) => {
          if (isClosed) return; // Don't send if already closed
          
          try {
            const sseData = `data: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(sseData));
          } catch (error) {
            // Controller might be closed, ignore silently
            if (error.code !== 'ERR_INVALID_STATE') {
              console.warn('⚠️  SSE send error:', error.message);
            }
            isClosed = true;
          }
        };

        // Send initial connection event
        sendEvent({ type: 'connected', jobId });

        // Attempt to load last known snapshot for instant UI updates
        try {
          redisSnapshotClient = createClient({ url: redisUrl });
          redisSnapshotClient.on("error", (err) => {
            console.warn("⚠️  Redis Snapshot Client Error:", err.message);
          });
          await redisSnapshotClient.connect();
          const snapshotKey = `job:${jobId}:status:last`;
          const cachedSnapshot = await redisSnapshotClient.get(snapshotKey);
          if (cachedSnapshot) {
            const parsedSnapshot = JSON.parse(cachedSnapshot);
            if (!isClosed) {
              sendEvent({
                type: "status",
                ...parsedSnapshot,
              });
              if (["completed", "failed", "cancelled", "timeout"].includes(parsedSnapshot.status)) {
                sendEvent({
                  type: "complete",
                  status: parsedSnapshot.status,
                  finalProgress: parsedSnapshot.progress || 0,
                });
              }
            }
          }
        } catch (snapshotError) {
          console.warn("⚠️  Failed to load job snapshot:", snapshotError.message);
        }

        // ✅ REDIS-FIRST: Try to subscribe to Redis Pub/Sub
        try {
          redisSubscriber = createClient({
            url: redisUrl
          });

          redisSubscriber.on('error', (err) => {
            console.warn('⚠️  Redis Subscriber Error:', err.message);
            // Fallback to DB polling if Redis fails
            if (!pollInterval) {
              startDBPolling();
            }
          });

          await redisSubscriber.connect();
          
          const channel = `job:${jobId}:status`;
          
          // Subscribe to progress updates
          await redisSubscriber.subscribe(channel, (message) => {
            if (isClosed) return; // Don't process if already closed
            
            try {
              const data = JSON.parse(message);
              
              // Verify job belongs to user (security check)
              if (data.campaignId && !isClosed) {
                sendEvent({
                  type: 'status',
                  ...data
                });
                
                // Close stream if job is finished
                if (['completed', 'failed', 'cancelled', 'timeout'].includes(data.status)) {
                  sendEvent({ 
                    type: 'complete', 
                    status: data.status,
                    finalProgress: data.progress || 0
                  });
                  cleanup();
                }
              }
            } catch (parseError) {
              // Only log if it's not a controller closed error
              if (!parseError.message.includes('Controller is already closed')) {
                console.error('❌ Failed to parse Redis message:', parseError.message);
              }
            }
          });
          
          console.log(`✅ SSE: Subscribed to Redis channel: ${channel}`);
          useRedis = true;
          
        } catch (redisError) {
          console.warn('⚠️  Redis Pub/Sub failed, falling back to DB polling:', redisError.message);
          useRedis = false;
          startDBPolling();
        }

        // ✅ FALLBACK: DB polling if Redis is unavailable
        function startDBPolling() {
          if (pollInterval) return; // Already polling
          
          let lastStatus = null;
          let lastProgress = null;
          let lastProcessedLeads = null;
          
          console.log('📊 SSE: Starting DB polling fallback...');
          
          pollInterval = setInterval(async () => {
            if (isClosed) {
              clearInterval(pollInterval);
              pollInterval = null;
              return;
            }
            
            try {
              // Fetch current job status
              const job = await db.query.workflowJobs.findFirst({
                where: and(
                  eq(workflowJobs.id, jobId),
                  eq(workflowJobs.userId, user.id)
                )
              });

              if (!job) {
                if (!isClosed) {
                  sendEvent({ type: 'error', message: 'Job not found' });
                }
                cleanup();
                return;
              }

              // Check if status changed
              const statusChanged = lastStatus !== job.status;
              const progressChanged = lastProgress !== job.progress;
              const processedChanged = lastProcessedLeads !== job.processedLeads;

              // Only send update if something changed and not closed
              if ((statusChanged || progressChanged || processedChanged) && !isClosed) {
                sendEvent({
                  type: 'status',
                  jobId: job.id,
                  campaignId: job.campaignId,
                  status: job.status,
                  progress: job.progress || 0,
                  totalLeads: job.totalLeads,
                  processedLeads: job.processedLeads || 0,
                  results: job.results,
                  errorMessage: job.errorMessage,
                  createdAt: job.createdAt,
                  startedAt: job.startedAt,
                  completedAt: job.completedAt
                });

                // Update last known values
                lastStatus = job.status;
                lastProgress = job.progress;
                lastProcessedLeads = job.processedLeads;
              }

              // Close stream if job is finished
              if (['completed', 'failed', 'cancelled', 'timeout'].includes(job.status)) {
                if (!isClosed) {
                  sendEvent({ 
                    type: 'complete', 
                    status: job.status,
                    finalProgress: job.progress || 0
                  });
                }
                cleanup();
              }

            } catch (error) {
              if (!isClosed) {
                console.error('❌ SSE Poll Error:', error);
                sendEvent({ type: 'error', message: error.message });
              }
              cleanup();
            }
          }, 2000); // Poll every 2 seconds as fallback
        }

        // Cleanup function (idempotent - safe to call multiple times)
        function cleanup() {
          if (isClosed) return; // Already cleaned up
          
          isClosed = true; // Mark as closed first to prevent new sends
          
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
          if (redisSnapshotClient) {
            redisSnapshotClient.quit().catch(() => {});
            redisSnapshotClient = null;
          }
          if (redisSubscriber) {
            redisSubscriber.quit().catch(() => {});
            redisSubscriber = null;
          }
          
          try {
            controller.close();
          } catch (error) {
            // Controller might already be closed, ignore
          }
        }

        // Send heartbeat every 30 seconds to keep connection alive
        heartbeatInterval = setInterval(() => {
          if (!isClosed) {
            try {
              controller.enqueue(encoder.encode(': heartbeat\n\n'));
            } catch (error) {
              // Controller closed, cleanup
              if (error.code === 'ERR_INVALID_STATE') {
                cleanup();
              }
            }
          } else {
            // Already closed, clear interval
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
        }, 30000);

        // Cleanup on client disconnect
        request.signal.addEventListener('abort', () => {
          cleanup();
        });
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      },
    });

  } catch (error) {
    console.error('❌ SSE Stream Error:', error);
    return NextResponse.json(
      { error: 'Failed to create SSE stream', message: error.message },
      { status: 500 }
    );
  }
});

