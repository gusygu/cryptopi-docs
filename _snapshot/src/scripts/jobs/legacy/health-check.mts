 
const base = process.env.BASE_URL || 'http://localhost:3000';

async function main() {
  const res = await fetch(`${base}/api/health`, { cache: 'no-store' });
  if (!res.ok) {
    console.error('Health endpoint returned non-OK:', res.status, await res.text());
    process.exit(2);
  }
  const body = await res.json();
  if (!body?.ok) {
    console.error('Health payload missing ok=true:', body);
    process.exit(3);
  }
  console.log('OK:', body);
}

main().catch((e) => {
  console.error('Health check failed:', e);
  process.exit(1);
});
