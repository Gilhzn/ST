import { useLocalSearchParams } from 'expo-router';

import { ChatScreen } from '@/features/chat/ChatScreen';

export default function GameRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatScreen key={String(id)} gameId={String(id)} />;
}
