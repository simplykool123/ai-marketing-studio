import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

try {
  console.log('Connecting to database...\n');

  const tables = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);

  console.log(`✓ Connected! Found ${tables.rows.length} tables:`);
  tables.rows.forEach(r => console.log(`  - ${r.table_name}`));

  if (tables.rows.some(r => r.table_name === 'users')) {
    const users = await pool.query('SELECT COUNT(*) as count FROM users');
    console.log(`\n✓ Users: ${users.rows[0].count}`);
  }

  if (tables.rows.some(r => r.table_name === 'clients')) {
    const clients = await pool.query('SELECT COUNT(*) as count FROM clients');
    console.log(`✓ Clients: ${clients.rows[0].count}`);
  }

  if (tables.rows.some(r => r.table_name === 'posts')) {
    const posts = await pool.query('SELECT COUNT(*) as count FROM posts');
    console.log(`✓ Posts: ${posts.rows[0].count}`);
  }

  await pool.end();
  console.log('\n✓ Database connection verified');
} catch (err) {
  console.error('✗ Database error:', err.message);
  await pool.end();
  process.exit(1);
}
