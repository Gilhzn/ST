/**
 * Native media picker for the Media Vault (VAULT-009): the system photo picker (PHPicker on
 * iOS, Android Photo Picker), so no broad media permission is requested. EXIF is not requested;
 * the server strips metadata again before publishing (VAULT-003).
 */
import * as ImagePicker from 'expo-image-picker';

import type { PickResult } from './pick.types';

export type { PickResult };

export async function pickMedia(): Promise<PickResult> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    videoMaxDuration: 60,
    quality: 0.9,
    exif: false,
    allowsMultipleSelection: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return { status: 'cancelled' };
  const kind = asset.type === 'video' ? 'video' : 'photo';
  return {
    status: 'picked',
    file: {
      uri: asset.uri,
      mimeType: asset.mimeType ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
      sizeBytes: asset.fileSize ?? 0,
      kind,
      durationSeconds: asset.duration != null ? asset.duration / 1000 : null,
    },
  };
}
