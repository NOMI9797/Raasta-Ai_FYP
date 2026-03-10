import { db } from "@/libs/db";
import { agentRuns, agentSteps } from "@/libs/schema";
import { eq, and } from "drizzle-orm";

/**
 * AgentRunner — executes a pipeline definition step-by-step.
 *
 * Pipeline definition format:
 *   { steps: [{ key, label, isCheckpoint, execute(ctx) }] }
 *
 * Modes:
 *   full_auto  — checkpoint steps are auto-approved (skipped)
 *   semi_auto  — checkpoint steps pause and wait for human /approve call
 */
export class AgentRunner {
  constructor({ runId, pipeline, mode, userId, config }) {
    this.runId = runId;
    this.pipeline = pipeline;
    this.mode = mode;
    this.userId = userId;
    this.config = config;
    this.stepOutputs = {};
  }

  async execute() {
    const steps = this.pipeline.steps;

    await db
      .update(agentRuns)
      .set({ status: "running", startedAt: new Date(), totalSteps: steps.length })
      .where(eq(agentRuns.id, this.runId));

    // Create all step rows up front
    for (let i = 0; i < steps.length; i++) {
      await db.insert(agentSteps).values({
        agentRunId: this.runId,
        stepKey: steps[i].key,
        stepIndex: i,
        status: "pending",
      });
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Reload run to check for cancellation
      const [run] = await db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.id, this.runId))
        .limit(1);

      if (run.status === "cancelled") {
        await this._updateStep(step.key, { status: "skipped" });
        continue;
      }

      await db
        .update(agentRuns)
        .set({ currentStep: step.key })
        .where(eq(agentRuns.id, this.runId));

      // Handle checkpoint steps
      if (step.isCheckpoint) {
        if (this.mode === "full_auto") {
          await this._updateStep(step.key, { status: "skipped", completedAt: new Date() });
          continue;
        }
        // Semi-auto: pause and wait for approval
        await this._updateStep(step.key, { status: "awaiting_approval", startedAt: new Date() });
        await db
          .update(agentRuns)
          .set({ status: "paused_at_checkpoint" })
          .where(eq(agentRuns.id, this.runId));
        return { paused: true, stepKey: step.key, stepIndex: i };
      }

      // Execute the step
      try {
        await this._updateStep(step.key, { status: "running", startedAt: new Date() });

        const ctx = {
          db,
          userId: this.userId,
          config: this.config,
          stepOutputs: this.stepOutputs,
          runId: this.runId,
        };

        const result = await step.execute(ctx);
        this.stepOutputs[step.key] = result;

        await this._updateStep(step.key, {
          status: "completed",
          output: result || {},
          completedAt: new Date(),
        });

        // Update accumulated results
        await db
          .update(agentRuns)
          .set({ results: this.stepOutputs })
          .where(eq(agentRuns.id, this.runId));
      } catch (err) {
        console.error(`Agent step ${step.key} failed:`, err);
        await this._updateStep(step.key, {
          status: "failed",
          output: { error: err.message },
          completedAt: new Date(),
        });
        await db
          .update(agentRuns)
          .set({
            status: "failed",
            errorMessage: `Step "${step.key}" failed: ${err.message}`,
            completedAt: new Date(),
            results: this.stepOutputs,
          })
          .where(eq(agentRuns.id, this.runId));
        return { failed: true, stepKey: step.key, error: err.message };
      }
    }

    // All steps complete
    await db
      .update(agentRuns)
      .set({ status: "completed", completedAt: new Date(), results: this.stepOutputs })
      .where(eq(agentRuns.id, this.runId));

    return { completed: true };
  }

  /**
   * Resume execution after a checkpoint was approved.
   * Called from the /approve API endpoint.
   */
  async resumeAfterCheckpoint() {
    const [run] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, this.runId))
      .limit(1);

    if (!run || run.status !== "paused_at_checkpoint") {
      throw new Error("Run is not paused at a checkpoint");
    }

    // Find the checkpoint step and mark it approved
    const allSteps = await db
      .select()
      .from(agentSteps)
      .where(eq(agentSteps.agentRunId, this.runId))
      .orderBy(agentSteps.stepIndex);

    let resumeIndex = -1;
    for (const s of allSteps) {
      if (s.status === "awaiting_approval") {
        await this._updateStep(s.stepKey, { status: "approved", completedAt: new Date() });
        resumeIndex = s.stepIndex + 1;
        break;
      }
    }

    if (resumeIndex < 0 || resumeIndex >= this.pipeline.steps.length) {
      await db
        .update(agentRuns)
        .set({ status: "completed", completedAt: new Date(), results: this.stepOutputs })
        .where(eq(agentRuns.id, this.runId));
      return { completed: true };
    }

    // Load previous step outputs from DB
    const completedSteps = allSteps.filter(
      (s) => s.status === "completed" || s.status === "approved" || s.status === "skipped"
    );
    for (const s of completedSteps) {
      if (s.output) this.stepOutputs[s.stepKey] = s.output;
    }

    await db
      .update(agentRuns)
      .set({ status: "running" })
      .where(eq(agentRuns.id, this.runId));

    // Continue from the step after the checkpoint
    const steps = this.pipeline.steps;
    for (let i = resumeIndex; i < steps.length; i++) {
      const step = steps[i];

      const [freshRun] = await db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.id, this.runId))
        .limit(1);

      if (freshRun.status === "cancelled") {
        await this._updateStep(step.key, { status: "skipped" });
        continue;
      }

      await db
        .update(agentRuns)
        .set({ currentStep: step.key })
        .where(eq(agentRuns.id, this.runId));

      if (step.isCheckpoint) {
        if (this.mode === "full_auto") {
          await this._updateStep(step.key, { status: "skipped", completedAt: new Date() });
          continue;
        }
        await this._updateStep(step.key, { status: "awaiting_approval", startedAt: new Date() });
        await db
          .update(agentRuns)
          .set({ status: "paused_at_checkpoint" })
          .where(eq(agentRuns.id, this.runId));
        return { paused: true, stepKey: step.key, stepIndex: i };
      }

      try {
        await this._updateStep(step.key, { status: "running", startedAt: new Date() });
        const ctx = {
          db,
          userId: this.userId,
          config: this.config,
          stepOutputs: this.stepOutputs,
          runId: this.runId,
        };
        const result = await step.execute(ctx);
        this.stepOutputs[step.key] = result;
        await this._updateStep(step.key, {
          status: "completed",
          output: result || {},
          completedAt: new Date(),
        });
        await db
          .update(agentRuns)
          .set({ results: this.stepOutputs })
          .where(eq(agentRuns.id, this.runId));
      } catch (err) {
        console.error(`Agent step ${step.key} failed:`, err);
        await this._updateStep(step.key, {
          status: "failed",
          output: { error: err.message },
          completedAt: new Date(),
        });
        await db
          .update(agentRuns)
          .set({
            status: "failed",
            errorMessage: `Step "${step.key}" failed: ${err.message}`,
            completedAt: new Date(),
            results: this.stepOutputs,
          })
          .where(eq(agentRuns.id, this.runId));
        return { failed: true, stepKey: step.key, error: err.message };
      }
    }

    await db
      .update(agentRuns)
      .set({ status: "completed", completedAt: new Date(), results: this.stepOutputs })
      .where(eq(agentRuns.id, this.runId));
    return { completed: true };
  }

  async _updateStep(stepKey, data) {
    await db
      .update(agentSteps)
      .set(data)
      .where(
        and(eq(agentSteps.agentRunId, this.runId), eq(agentSteps.stepKey, stepKey))
      );
  }
}

/**
 * Helper to get the pipeline definition by type.
 */
export async function getPipelineDefinition(pipelineType) {
  if (pipelineType === "recruiter") {
    const { recruiterPipeline } = await import("@/libs/agent-pipelines/recruiter");
    return recruiterPipeline;
  }
  if (pipelineType === "sales_operator") {
    const { salesOperatorPipeline } = await import("@/libs/agent-pipelines/sales-operator");
    return salesOperatorPipeline;
  }
  throw new Error(`Unknown pipeline type: ${pipelineType}`);
}
