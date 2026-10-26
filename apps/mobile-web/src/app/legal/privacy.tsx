import { LegalArticle } from '@/features/legal/LegalArticle';

export default function PrivacyScreen() {
  return <LegalArticle page="privacy" testID="screen.legal.privacy" sections={['collect', 'use', 'share', 'retention', 'rights', 'age']} />;
}
