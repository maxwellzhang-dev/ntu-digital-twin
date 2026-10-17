import { cacheLife } from 'next/cache';
import { getFacilitiesGeoJson } from '@/lib/environment';

async function getFacilities() {
  'use cache';
  cacheLife('hours');
  return getFacilitiesGeoJson();
}

export async function GET() {
  return Response.json(await getFacilities());
}
