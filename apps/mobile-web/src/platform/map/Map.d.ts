/**
 * Type facade for the platform map. Metro resolves `./Map` to `Map.web.tsx` or
 * `Map.native.tsx`; both are type-checked against `MapViewProps`. Import values
 * (`zoomForRadius`, `VENUE_MIN_ZOOM`) from `./Map.types`, never from here.
 */
import type { JSX } from 'react';

import type { MapViewProps } from './Map.types';

export declare function Map(props: MapViewProps): JSX.Element;
export type { MapPoint, MapRegion, MapViewProps, MapPinState, MapPadding } from './Map.types';
