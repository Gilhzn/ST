import { probe } from '#shared/probe';
import { DEFAULT_TRUST_CONFIG } from '@st/domain';
export const value: number = probe(DEFAULT_TRUST_CONFIG.chatMuteHours);
