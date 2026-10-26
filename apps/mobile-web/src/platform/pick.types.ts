import type { PickedMedia } from '@/data/extensions';

/**
 * - `picked`: the user chose a photo or video.
 * - `cancelled`: the picker was closed.
 * - `unavailable`: no picker on this platform build (native needs expo-image-picker).
 */
export type PickResult = { status: 'picked'; file: PickedMedia } | { status: 'cancelled' } | { status: 'unavailable' };
