import { cacheLife } from 'next/cache';
import { getStopsAndRoutes } from '@/lib/transit';

async function getStops() {
  'use cache';
  cacheLife('hours');
  return getStopsAndRoutes();
}

export async function GET() {
  return Response.json(await getStops());
}
