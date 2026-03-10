import { db } from "@/libs/db";
import { agentRuns, agentSteps } from "@/libs/schema";
import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/libs/next-auth";

export async function GET(request, { params }) {
  const { runId } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let lastStatus = null;
      let iterations = 0;
      const maxIterations = 300; // ~5 minutes at 1s intervals

      const poll = async () => {
        try {
          const [run] = await db
            .select()
            .from(agentRuns)
            .where(eq(agentRuns.id, runId))
            .limit(1);

          if (!run) {
            send({ type: "error", message: "Run not found" });
            controller.close();
            return;
          }

          const steps = await db
            .select()
            .from(agentSteps)
            .where(eq(agentSteps.agentRunId, runId))
            .orderBy(agentSteps.stepIndex);

          const statusChanged = run.status !== lastStatus;
          lastStatus = run.status;

          send({
            type: "update",
            run: {
              id: run.id,
              status: run.status,
              currentStep: run.currentStep,
              totalSteps: run.totalSteps,
              errorMessage: run.errorMessage,
            },
            steps: steps.map((s) => ({
              stepKey: s.stepKey,
              stepIndex: s.stepIndex,
              status: s.status,
            })),
          });

          if (["completed", "failed", "cancelled"].includes(run.status)) {
            send({ type: "done", finalStatus: run.status });
            controller.close();
            return;
          }

          iterations++;
          if (iterations >= maxIterations) {
            send({ type: "timeout" });
            controller.close();
            return;
          }

          await new Promise((r) => setTimeout(r, 1000));
          await poll();
        } catch (err) {
          send({ type: "error", message: err.message });
          controller.close();
        }
      };

      await poll();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
