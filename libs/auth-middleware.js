import { getServerSession } from "next-auth";
import { authOptions } from "@/libs/next-auth";
import { db } from "@/libs/db";
import { users } from "@/libs/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Authenticates the user and retrieves their session and database user object.
 * @param {Request} request - The Next.js request object
 * @param {Object} options - Configuration options
 * @param {boolean} options.requireUser - Whether to require user in database (default: true)
 * @param {boolean} options.createUser - Whether to create user if not exists (default: true)
 * @returns {Object} { user, session, isAuthenticated, error }
 */
export async function authenticateUser(request, options = {}) {
  const { requireUser = false, createUser = true } = options;

  try {
    // Get session from NextAuth
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return {
        isAuthenticated: false,
        user: null,
        session: null,
        error: "Not authenticated",
      };
    }

    // Check if user exists in database
    let dbUser = null;
    if (session.user.email) {
      try {
        const [existingUser] = await db
          .select()
          .from(users)
          .where(eq(users.email, session.user.email))
          .limit(1);

        dbUser = existingUser;
      } catch (error) {
        console.warn("Database not ready, skipping user lookup:", error.message);
        // Continue without database user for now
      }
    }

    // Create user if doesn't exist and createUser is true
    if (!dbUser && createUser && session.user.email) {
      try {
        const [newUser] = await db
          .insert(users)
          .values({
            id: session.user.id, // Use Google ID as primary key
            email: session.user.email,
            name: session.user.name || null,
            image: session.user.image || null,
            googleId: session.user.id,
            subscriptionStatus: 'free',
          })
          .returning();

        dbUser = newUser;
      } catch (error) {
        console.warn("Database not ready, skipping user creation:", error.message);
        // Handle unique constraint violation (user might have been created by another request)
        if (error.code === '23505') { // PostgreSQL unique violation
          try {
            const [existingUser] = await db
              .select()
              .from(users)
              .where(eq(users.email, session.user.email))
              .limit(1);

            dbUser = existingUser;
          } catch (lookupError) {
            console.warn("Failed to lookup existing user:", lookupError.message);
          }
        }
        // Continue without database user for now
      }
    }

    // If we require user in database but don't have one
    if (requireUser && !dbUser) {
      return {
        isAuthenticated: false,
        error: "User not found in database",
        user: null,
        session: null,
      };
    }

    // Update user info if session data is newer
    if (dbUser && createUser) {
      const needsUpdate =
        dbUser.name !== session.user.name ||
        dbUser.image !== session.user.image;

      if (needsUpdate) {
        try {
          const [updatedUser] = await db
            .update(users)
            .set({
              name: session.user.name || dbUser.name,
              image: session.user.image || dbUser.image,
              updatedAt: new Date(),
            })
            .where(eq(users.id, dbUser.id))
            .returning();

          dbUser = updatedUser;
        } catch (error) {
          console.warn("Database not ready, skipping user update:", error.message);
          // Continue with existing user data
        }
      }
    }

    return {
      isAuthenticated: true,
      user: dbUser || session.user, // Return dbUser if available, otherwise session.user
      session,
      error: null,
    };
  } catch (error) {
    console.error("Authentication error:", error);
    return {
      isAuthenticated: false,
      user: null,
      session: null,
      error: error.message || "Authentication failed",
    };
  }
}

export function withAuth(handler, options = {}) {
  return async (request, context) => {
    const { user, isAuthenticated, error } = await authenticateUser(request, options);

    if (!isAuthenticated) {
      return NextResponse.json({ error: error || "Not authenticated" }, { status: 401 });
    }

    // Attach the user object to the context for the handler
    return handler(request, { ...context, user });
  };
}