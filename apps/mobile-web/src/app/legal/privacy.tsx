import { LegalPage } from '@/components/LegalPage';

export default function PrivacyScreen() {
  return <LegalPage page="privacy" testID="screen.legal.privacy" sections={['collect', 'use', 'share', 'retention', 'rights', 'age']} />;
}
