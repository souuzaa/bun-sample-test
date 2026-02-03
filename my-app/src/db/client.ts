import postgres from 'postgres';

// Connection to PgBouncer (not directly to PostgreSQL)
const sql = postgres({
  host: process.env.DB_HOST || 'pgbouncer',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'myapp',
  username: process.env.DB_USER || 'myapp',
  password: process.env.DB_PASSWORD || 'myapp_secret',

  // Connection pool settings (application-level)
  // Keep small since PgBouncer does the heavy lifting
  max: 5,
  idle_timeout: 30,
  connect_timeout: 10,

  // CRITICAL for PgBouncer transaction mode
  prepare: false,  // Disable prepared statements

  // Performance optimizations
  fetch_types: false,  // Skip type fetching on startup

  // Transform snake_case to camelCase
  transform: {
    column: (col) => col.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
  },
});

// Health check query
export const healthCheck = () => sql`SELECT 1 as ok`;

// Graceful shutdown
export const closeDb = () => sql.end();

export { sql };
