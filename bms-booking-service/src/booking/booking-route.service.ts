import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type Coordinates = { lat: number; lng: number };
type GoogleWaypoint = { address?: string; placeId?: string };

export type BookingRoute = {
  distanceKm: number;
  durationMin: number;
  origin: Coordinates;
  destination: Coordinates;
  geometry: [number, number][];
  provider: 'google';
};

@Injectable()
export class BookingRouteService {
  constructor(private readonly config: ConfigService) {}

  async calculateRoute(
    pickupAddress: string,
    deliveryAddress: string,
    pickupLandmark?: string,
    deliveryLandmark?: string,
  ): Promise<BookingRoute> {
    const key = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    if (!key) throw new ServiceUnavailableException('Google Routes API is not configured.');
    const geocodingKey = this.config.get<string>('GOOGLE_GEOCODING_API_KEY') || key;
    const [origin, destination] = await Promise.all([
      this.resolveWaypoint(pickupAddress, pickupLandmark, geocodingKey),
      this.resolveWaypoint(deliveryAddress, deliveryLandmark, geocodingKey),
    ]);
    return this.calculateGoogleRoute(origin, destination, key);
  }

  private async resolveWaypoint(address: string, landmark: string | undefined, key: string): Promise<GoogleWaypoint> {
    const addressResult = await this.geocodePlaceId(address, key);
    if (addressResult.placeId) return { placeId: addressResult.placeId };
    // A landmark is a fallback only when Google explicitly reports no address result.
    if (!addressResult.notFound) return { address };
    const fallback = landmark?.trim();
    if (fallback) {
      const landmarkResult = await this.geocodePlaceId(fallback, key);
      if (landmarkResult.placeId) return { placeId: landmarkResult.placeId };
    }
    return { address: fallback || address };
  }

  private async geocodePlaceId(address: string, key: string): Promise<{ placeId: string | null; notFound: boolean }> {
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&components=country:PH&key=${encodeURIComponent(key)}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!response.ok) return { placeId: null, notFound: false };
      const data = await response.json() as { status?: string; results?: Array<{ place_id?: string }> };
      return {
        placeId: data.status === 'OK' ? data.results?.[0]?.place_id ?? null : null,
        notFound: data.status === 'ZERO_RESULTS',
      };
    } catch {
      return { placeId: null, notFound: false };
    }
  }

  private async calculateGoogleRoute(origin: GoogleWaypoint, destination: GoogleWaypoint, key: string): Promise<BookingRoute> {
    try {
      const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
        },
        body: JSON.stringify({
          origin, destination, travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE_OPTIMAL', trafficModel: 'BEST_GUESS',
          departureTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Google Routes API returned ${response.status}`);
      const data = await response.json() as {
        routes?: Array<{ distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }>;
      };
      const route = data.routes?.[0];
      const distance = route?.distanceMeters;
      const duration = Number.parseInt(route?.duration ?? '', 10);
      const geometry = route?.polyline?.encodedPolyline ? decodePolyline(route.polyline.encodedPolyline) : [];
      if (distance === undefined || !Number.isFinite(distance) || !Number.isFinite(duration) || geometry.length < 2) {
        throw new Error('Google Routes API did not return a usable route');
      }
      return {
        distanceKm: distance / 1000,
        durationMin: Math.max(1, Math.round(duration / 60)),
        origin: { lat: geometry[0][0], lng: geometry[0][1] },
        destination: { lat: geometry[geometry.length - 1][0], lng: geometry[geometry.length - 1][1] },
        geometry, provider: 'google',
      };
    } catch {
      throw new ServiceUnavailableException('A route could not be calculated for these addresses.');
    }
  }
}

function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    const read = () => {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);
      return result & 1 ? ~(result >> 1) : result >> 1;
    };
    latitude += read();
    longitude += read();
    points.push([latitude / 1e5, longitude / 1e5]);
  }
  return points;
}
