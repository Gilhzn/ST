import { expect, it } from 'vitest';
import { value } from './handler';
it('resolves #shared', () => { expect(value).toBe(25); });
