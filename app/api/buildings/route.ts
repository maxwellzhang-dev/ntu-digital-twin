import { cacheLife } from 'next/cache';
import { getCampusData } from '@/lib/digitaltwin';

async function getBuildings() {
  'use cache';
  cacheLife('hours');
  return getCampusData();
}

export async function GET() {
  return Response.json(await getBuildings());
}
