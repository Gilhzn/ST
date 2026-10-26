import { LegalArticle } from '@/features/legal/LegalArticle';

export default function TermsScreen() {
  return <LegalArticle page="terms" testID="screen.legal.terms" sections={['account', 'conduct', 'games', 'deposits', 'sanctions', 'changes']} />;
}
