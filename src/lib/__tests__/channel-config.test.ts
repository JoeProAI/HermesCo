import { 
  validateCredentials, 
  buildOpenClawConfig, 
  isSelfServable, 
  CHANNELS 
} from '../channel-config';

describe('channel-config', () => {
  test('CHANNELS has exactly 17 entries', () => {
    expect(CHANNELS).toHaveLength(17);
  });

  describe('validateCredentials', () => {
    test('returns null when all required fields present (telegram)', () => {
      const result = validateCredentials('telegram', { botToken: '12345:ABC' });
      expect(result).toBeNull();
    });

    test('returns error when required field missing (telegram)', () => {
      const result = validateCredentials('telegram', { botToken: '' });
      expect(result).toBe('Missing required field: Bot Token');
    });

    test('returns unknown channel error', () => {
      const result = validateCredentials('fakechannel', {});
      expect(result).toBe('Unknown channel: fakechannel');
    });
  });

  describe('buildOpenClawConfig', () => {
    test('telegram returns correct config shape', () => {
      const config = buildOpenClawConfig('telegram', { botToken: '12345:ABC' });
      expect(config).toEqual({
        botToken: '12345:ABC',
        streamMode: 'partial',
        draftChunk: { minChars: 200, maxChars: 800 },
      });
    });

    test('discord returns correct config shape', () => {
      const config = buildOpenClawConfig('discord', { token: 'MTIzN...' });
      expect(config).toEqual({
        token: 'MTIzN...',
        maxLinesPerMessage: 17,
        blockStreaming: false,
      });
    });

    test('whatsapp returns authDir config', () => {
      const config = buildOpenClawConfig('whatsapp', {});
      expect(config).toHaveProperty('accounts.default.authDir');
      expect(config.accounts?.default.authDir).toBe('/home/node/.openclaw/wa-auth');
    });

    test('slack returns 3-field config', () => {
      const config = buildOpenClawConfig('slack', {
        appToken: 'xapp-1-...',
        botToken: 'xoxb-...',
        signingSecret: 'secret123',
      });
      expect(config).toEqual({
        appToken: 'xapp-1-...',
        botToken: 'xoxb-...',
        signingSecret: 'secret123',
      });
    });
  });

  describe('isSelfServable', () => {
    test('returns true for token/wave1 channels', () => {
      expect(isSelfServable('telegram')).toBe(true);
      expect(isSelfServable('discord')).toBe(true);
      expect(isSelfServable('slack')).toBe(true);
    });

    test('returns false for non-self-serve channels', () => {
      expect(isSelfServable('whatsapp')).toBe(false);
      expect(isSelfServable('signal')).toBe(false);
      expect(isSelfServable('imessage')).toBe(false);
    });

    test('returns false for unknown channels', () => {
      expect(isSelfServable('fake')).toBe(false);
    });
  });
});
