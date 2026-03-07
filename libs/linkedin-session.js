import { db } from './db';
import { linkedinAccounts } from './schema';
import { eq, and, desc, inArray, ne } from 'drizzle-orm';

export class LinkedInSessionManager {
  constructor() {
    // No need for file system operations anymore
  }

  // Save session data
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
      isActive: false, // Default to inactive
    };

    try {
      const result = await db.insert(linkedinAccounts).values(sessionData).returning();
      return result[0];
    } catch (error) {
      console.error('Error saving session to database:', error);
      throw error;
    }
  }

  // Load session data
  async loadSession(sessionId) {
    try {
      const result = await db
        .select()
        .from(linkedinAccounts)
        .where(eq(linkedinAccounts.sessionId, sessionId))
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      const session = result[0];
      
      // Update last used timestamp
      await db
        .update(linkedinAccounts)
        .set({ lastUsed: new Date() })
        .where(eq(linkedinAccounts.sessionId, sessionId));
      
      return session;
    } catch (error) {
      console.error('Error loading session from database:', error);
      return null;
    }
  }

  // Get all sessions for a user
  async getAllSessions(userId = null) {
    try {
      let query = db.select().from(linkedinAccounts);
      
      if (userId) {
        query = query.where(eq(linkedinAccounts.userId, userId));
      }
      
      const sessions = await query.orderBy(desc(linkedinAccounts.lastUsed));
      return sessions;
    } catch (error) {
      console.error('Error getting all sessions from database:', error);
      return [];
    }
  }

  // Delete session
  async deleteSession(sessionId) {
    try {
      const result = await db
        .delete(linkedinAccounts)
        .where(eq(linkedinAccounts.sessionId, sessionId))
        .returning();
      
      return result.length > 0;
    } catch (error) {
      console.error('Error deleting session from database:', error);
      return false;
    }
  }

  // Clean up old sessions (older than 30 days)
  async cleanupOldSessions() {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await db
        .delete(linkedinAccounts)
        .where(eq(linkedinAccounts.lastUsed, thirtyDaysAgo))
        .returning();
      
      return result.length;
    } catch (error) {
      console.error('Error cleaning up old sessions:', error);
      return 0;
    }
  }

  // Get session by email
  async getSessionByEmail(email, userId = null) {
    try {
      let query = db
        .select()
        .from(linkedinAccounts)
        .where(eq(linkedinAccounts.email, email));
      
      if (userId) {
        query = query.where(and(
          eq(linkedinAccounts.email, email),
          eq(linkedinAccounts.userId, userId)
        ));
      }
      
      const result = await query.limit(1);
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error('Error getting session by email:', error);
      return null;
    }
  }

  // Check if session exists and is valid
  async isSessionValid(sessionId) {
    const session = await this.loadSession(sessionId);
    return session !== null;
  }

  // Update session status (like isActive)
  async updateSessionStatus(sessionId, updates) {
    try {
      const result = await db
        .update(linkedinAccounts)
        .set({
          ...updates,
          lastUsed: new Date()
        })
        .where(eq(linkedinAccounts.sessionId, sessionId))
        .returning();
      
      return result.length > 0;
    } catch (error) {
      console.error('Error updating session status:', error);
      return false;
    }
  }

  // Optimized: Toggle account status with single transaction
  async toggleAccountStatus(userId, accountId, isActive) {
    try {
      // Use a transaction to ensure atomicity
      return await db.transaction(async (tx) => {
        if (isActive) {
          // First, deactivate all other accounts for this user
          await tx
            .update(linkedinAccounts)
            .set({
              isActive: false,
              lastUsed: new Date()
            })
            .where(and(
              eq(linkedinAccounts.userId, userId),
              ne(linkedinAccounts.sessionId, accountId)
            ));
        }

        // Then activate/deactivate the target account
        const result = await tx
          .update(linkedinAccounts)
          .set({
            isActive,
            lastUsed: new Date()
          })
          .where(and(
            eq(linkedinAccounts.sessionId, accountId),
            eq(linkedinAccounts.userId, userId)
          ))
          .returning();

        return result.length > 0;
      });
    } catch (error) {
      console.error('Error toggling account status:', error);
      return false;
    }
  }

  // Batch update session status for multiple sessions
  async batchUpdateSessionStatus(userId, sessionIds, updates) {
    try {
      const result = await db
        .update(linkedinAccounts)
        .set({
          ...updates,
          lastUsed: new Date()
        })
        .where(and(
          eq(linkedinAccounts.userId, userId),
          inArray(linkedinAccounts.sessionId, sessionIds)
        ))
        .returning();
      
      return result.length;
    } catch (error) {
      console.error('Error batch updating session status:', error);
      return 0;
    }
  }
}

export default LinkedInSessionManager;
