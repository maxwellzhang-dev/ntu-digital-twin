import { connection } from 'next/server';
import { getEnvironment } from '@/lib/environment';

export async function GET() {
  // Live NEA data: request time, throttled by a 60 s in-memory cache in lib/environment.ts.
  await connection();
  return Response.json(await getEnvironment(), { headers: { 'Cache-Control': 'no-store' } });
}
