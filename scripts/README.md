# Scripts Directory

This directory contains utility scripts for database migrations, maintenance, and other administrative tasks.

## Available Scripts

### `update-daily-limits.js`

**Purpose**: Updates all LinkedIn accounts to have a maximum daily invite limit of 30.

**What it does**:
- Checks all LinkedIn accounts in the database
- Updates accounts with `daily_limit > 30` or `daily_limit IS NULL` to `daily_limit = 30`
- Updates `updatedAt` timestamp for modified records
- Provides detailed logging and confirmation

**When to use**:
- After changing the system-wide max daily limit from 100 to 30
- To ensure all accounts comply with new LinkedIn invite limits
- As part of deployment process when updating rate limit policies

**Usage**:
```bash
node scripts/update-daily-limits.js
```

**Output example**:
```
🚀 Starting migration: Update LinkedIn accounts daily limits
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Checking current state...

📋 Found 2 account(s) that need updating:
   1. user@example.com (current limit: 100)
   2. test@example.com (current limit: NULL)

⚠️  About to update these accounts to daily_limit = 30
⏳ Proceeding with migration in 2 seconds...

🔄 Updating accounts...

✅ Successfully updated 2 account(s):
   1. user@example.com → daily_limit = 30
   2. test@example.com → daily_limit = 30

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨ Migration completed successfully!
🎯 All LinkedIn accounts now have daily_limit ≤ 30
```

**Safety features**:
- Shows what will be changed before making changes
- 2-second delay allows cancellation with Ctrl+C
- Updates `updatedAt` timestamp for audit trail
- Graceful error handling with detailed logging
- Only updates accounts that need it (idempotent)

**Safe to run multiple times**: Yes, the script checks current state and only updates accounts that need it.

---

## Running Scripts

All scripts should be run from the project root directory:

```bash
# Make sure you're in the project root
cd /path/to/Reachly

# Run a script
node scripts/script-name.js
```

## Adding New Scripts

When creating new scripts:

1. Add them to this `scripts/` directory
2. Use ES modules (`import/export`) for consistency
3. Include clear logging with emojis for readability
4. Handle errors gracefully
5. Document the script in this README
6. Make scripts idempotent (safe to run multiple times)
7. Add confirmation delays for destructive operations

## Notes

- All scripts use the same database connection as the main application
- Environment variables are loaded from `.env` file
- Scripts run synchronously and exit when complete
- Use `console.log` for output (not application logging)

