/**
 * Native media picker for the Media Vault (VAULT-009).
 *
 * TODO(deps): `expo-image-picker` is not installed yet. Add it with
 *   `npx expo install expo-image-picker`
 * plus the `expo-image-picker` config plugin (photo-library + camera usage strings) in
 * app.json, then implement with `ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images',
 * 'videos'], videoMaxDuration: 60, quality: 0.9, exif: false })` and map the asset to
 * `PickedMedia` (uri, mimeType, fileSize, duration / 1000). Until then the gallery explains
 * that uploads are available on the web app.
 */
import type { PickResult } from './pick.types';

export type { PickResult };

export async function pickMedia(): Promise<PickResult> {
  return { status: 'unavailable' };
}
