import { LegalPage } from '@/components/LegalPage';

export default function TermsScreen() {
  return <LegalPage page="terms" testID="screen.legal.terms" sections={['account', 'conduct', 'games', 'deposits', 'sanctions', 'changes']} />;
}
