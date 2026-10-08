import { db } from './db';
import { indeedAccounts } from './schema';
import { eq, and, desc, ne } from 'drizzle-orm';

/**
 * IndeedSessionManager — mirrors RozeeSessionManager but persists to the
 * indeed_accounts table. Stores cookies + localStorage + sessionStorage so a
 * Playwright context can be hydrated to act as the signed-in Indeed employer.
 * The session is captured from a window the person signed in to themselves
 * (libs/indeed-connect.js); no Indeed password is ever handled here.
 */
export class IndeedSessionManager {
  /**
   * Save a freshly captured session. Connecting the same Indeed email again (after a sign-in check or an expired
   * session) refreshes that account in place, so jobs that point at it keep working and no duplicate appears.
   */
  async saveSession(sessionId, email, cookies, localStorage, sessionStorage, profileImageUrl = null, userName = null, userId = null) {
    if (!userId) {
      throw new Error('User ID is required for database storage');
    }

    try {
      const [existing] = await db
        .select()
        .from(indeedAccounts)
        .where(and(eq(indeedAccounts.userId, userId), eq(indeedAccounts.email, email)))
        .limit(1);
      if (existing) {
        const [updated] = await db
          .update(indeedAccounts)
          .set({ cookies, localStorage, sessionStorage, profileImageUrl, userName, lastUsed: new Date(), updatedAt: new Date() })
          .where(eq(indeedAccounts.id, existing.id))
          .returning();
        return updated;
      }
      const result = await db
        .insert(indeedAccounts)
        .values({ sessionId, userId, email, userName, cookies, localStorage, sessionStorage, profileImageUrl, isActive: false })
        .returning();
      return result[0];
    } catch (error) {
      console.error('Error saving Indeed session to database:', error);
      throw error;
    }
  }

  async loadSession(sessionId) {
    try {
      const result = await db
        .select()
        .from(indeedAccounts)
        .where(eq(indeedAccounts.sessionId, sessionId))
        .limit(1);

      if (result.length === 0) return null;

      await db
        .update(indeedAccounts)
        .set({ lastUsed: new Date() })
        .where(eq(indeedAccounts.sessionId, sessionId));

      return result[0];
    } catch (error) {
      console.error('Error loading Indeed session from database:', error);
      return null;
    }
  }

  async getAllSessions(userId = null) {
    try {
      let query = db.select().from(indeedAccounts);
      if (userId) {
        query = query.where(eq(indeedAccounts.userId, userId));
      }
      return await query.orderBy(desc(indeedAccounts.lastUsed));
    } catch (error) {
      console.error('Error getting all Indeed sessions:', error);
      return [];
    }
  }

  /** Remove an account. With `userId`, only that person's own account can be removed. */
  async deleteSession(sessionId, userId = null) {
    try {
      const where = userId
        ? and(eq(indeedAccounts.sessionId, sessionId), eq(indeedAccounts.userId, userId))
        : eq(indeedAccounts.sessionId, sessionId);
      const result = await db.delete(indeedAccounts).where(where).returning();
      return result.length > 0;
    } catch (error) {
      console.error('Error deleting Indeed session:', error);
      return false;
    }
  }

  async updateSessionStatus(sessionId, updates) {
    try {
      const result = await db
        .update(indeedAccounts)
        .set({ ...updates, lastUsed: new Date() })
        .where(eq(indeedAccounts.sessionId, sessionId))
        .returning();
      return result.length > 0;
    } catch (error) {
      console.error('Error updating Indeed session status:', error);
      return false;
    }
  }

  /** Switch an account on or off. Switching one on switches the person's other Indeed accounts off. */
  async toggleAccountStatus(userId, accountSessionId, isActive) {
    try {
      return await db.transaction(async (tx) => {
        if (isActive) {
          await tx
            .update(indeedAccounts)
            .set({ isActive: false, lastUsed: new Date() })
            .where(and(
              eq(indeedAccounts.userId, userId),
              ne(indeedAccounts.sessionId, accountSessionId)
            ));
        }

        const result = await tx
          .update(indeedAccounts)
          .set({ isActive, lastUsed: new Date() })
          .where(and(
            eq(indeedAccounts.sessionId, accountSessionId),
            eq(indeedAccounts.userId, userId)
          ))
          .returning();

        return result.length > 0;
      });
    } catch (error) {
      console.error('Error toggling Indeed account status:', error);
      return false;
    }
  }
}

export default IndeedSessionManager;
