import { db } from './db';
import { rozeeAccounts } from './schema';
import { eq, and, desc, inArray, ne } from 'drizzle-orm';

/**
 * RozeeSessionManager — mirrors LinkedInSessionManager but persists to the
 * rozee_accounts table. Stores cookies + localStorage + sessionStorage so a
 * Playwright context can be hydrated to act as the user on Rozee.pk.
 */
export class RozeeSessionManager {
  async saveSession(sessionId, email, cookies, localStorage, sessionStorage, profileImageUrl = null, userName = null, userId = null) {
    if (!userId) {
      throw new Error('User ID is required for database storage');
    }

    const sessionData = {
      sessionId,
      userId,
      email,
      userName,
      cookies,
      localStorage,
      sessionStorage,
      profileImageUrl,
      isActive: false,
    };

    try {
      const result = await db.insert(rozeeAccounts).values(sessionData).returning();
      return result[0];
    } catch (error) {
      console.error('Error saving Rozee session to database:', error);
      throw error;
    }
  }

  async loadSession(sessionId) {
    try {
      const result = await db
        .select()
        .from(rozeeAccounts)
        .where(eq(rozeeAccounts.sessionId, sessionId))
        .limit(1);

      if (result.length === 0) return null;

      const session = result[0];
      await db
        .update(rozeeAccounts)
        .set({ lastUsed: new Date() })
        .where(eq(rozeeAccounts.sessionId, sessionId));

      return session;
    } catch (error) {
      console.error('Error loading Rozee session from database:', error);
      return null;
    }
  }

  async getAllSessions(userId = null) {
    try {
      let query = db.select().from(rozeeAccounts);
      if (userId) {
        query = query.where(eq(rozeeAccounts.userId, userId));
      }
      const sessions = await query.orderBy(desc(rozeeAccounts.lastUsed));
      return sessions;
    } catch (error) {
      console.error('Error getting all Rozee sessions:', error);
      return [];
    }
  }

  async deleteSession(sessionId) {
    try {
      const result = await db
        .delete(rozeeAccounts)
        .where(eq(rozeeAccounts.sessionId, sessionId))
        .returning();
      return result.length > 0;
    } catch (error) {
      console.error('Error deleting Rozee session:', error);
      return false;
    }
  }

  async getSessionByEmail(email, userId = null) {
    try {
      let query = db
        .select()
        .from(rozeeAccounts)
        .where(eq(rozeeAccounts.email, email));

      if (userId) {
        query = query.where(and(
          eq(rozeeAccounts.email, email),
          eq(rozeeAccounts.userId, userId)
        ));
      }

      const result = await query.limit(1);
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error('Error getting Rozee session by email:', error);
      return null;
    }
  }

  async isSessionValid(sessionId) {
    const session = await this.loadSession(sessionId);
    return session !== null;
  }

  async updateSessionStatus(sessionId, updates) {
    try {
      const result = await db
        .update(rozeeAccounts)
        .set({ ...updates, lastUsed: new Date() })
        .where(eq(rozeeAccounts.sessionId, sessionId))
        .returning();
      return result.length > 0;
    } catch (error) {
      console.error('Error updating Rozee session status:', error);
      return false;
    }
  }

  async toggleAccountStatus(userId, accountSessionId, isActive) {
    try {
      return await db.transaction(async (tx) => {
        if (isActive) {
          await tx
            .update(rozeeAccounts)
            .set({ isActive: false, lastUsed: new Date() })
            .where(and(
              eq(rozeeAccounts.userId, userId),
              ne(rozeeAccounts.sessionId, accountSessionId)
            ));
        }

        const result = await tx
          .update(rozeeAccounts)
          .set({ isActive, lastUsed: new Date() })
          .where(and(
            eq(rozeeAccounts.sessionId, accountSessionId),
            eq(rozeeAccounts.userId, userId)
          ))
          .returning();

        return result.length > 0;
      });
    } catch (error) {
      console.error('Error toggling Rozee account status:', error);
      return false;
    }
  }

  async batchUpdateSessionStatus(userId, sessionIds, updates) {
    try {
      const result = await db
        .update(rozeeAccounts)
        .set({ ...updates, lastUsed: new Date() })
        .where(and(
          eq(rozeeAccounts.userId, userId),
          inArray(rozeeAccounts.sessionId, sessionIds)
        ))
        .returning();
      return result.length;
    } catch (error) {
      console.error('Error batch updating Rozee session status:', error);
      return 0;
    }
  }
}

export default RozeeSessionManager;
