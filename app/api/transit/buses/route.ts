import { connection } from 'next/server';
import { getLiveTransit } from '@/lib/transit';

export async function GET() {
  // Live LTA data: always run at request time (in-memory 20 s throttle lives in lib/transit.ts).
  await connection();
  return Response.json(await getLiveTransit(), { headers: { 'Cache-Control': 'no-store' } });
}
