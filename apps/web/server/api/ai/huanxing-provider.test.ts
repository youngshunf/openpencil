import { describe, it, expect, afterEach } from 'vitest';
import {
  HUANXING_PROVIDER_ID,
  isHuanxingDefaultRequest,
  readHuanxingDefaultCredentials,
  requireHuanxingDefaultCredentials,
} from './huanxing-provider';

const ENV_KEYS = [
  'OPENPENCIL_HUANXING_API_KEY',
  'OPENPENCIL_HUANXING_BASE_URL',
  'OPENPENCIL_HUANXING_MODEL',
] as const;

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

afterEach(clearEnv);

describe('isHuanxingDefaultRequest', () => {
  it('matches when useHuanxingDefault is true', () => {
    expect(isHuanxingDefaultRequest({ useHuanxingDefault: true })).toBe(true);
  });

  it('matches when builtinProviderId is huanxing', () => {
    expect(isHuanxingDefaultRequest({ builtinProviderId: HUANXING_PROVIDER_ID })).toBe(true);
  });

  it('does not match for other providers or empty input', () => {
    expect(isHuanxingDefaultRequest({})).toBe(false);
    expect(isHuanxingDefaultRequest({ builtinProviderId: 'openai' })).toBe(false);
    expect(isHuanxingDefaultRequest({ useHuanxingDefault: false })).toBe(false);
  });
});

describe('readHuanxingDefaultCredentials', () => {
  it('returns null when env credentials are absent (not configured)', () => {
    clearEnv();
    expect(readHuanxingDefaultCredentials()).toBeNull();
  });

  it('returns null when only one of key/baseURL is present', () => {
    clearEnv();
    process.env.OPENPENCIL_HUANXING_API_KEY = 'sk-owner';
    expect(readHuanxingDefaultCredentials()).toBeNull();
  });

  it('returns trimmed credentials when both key and baseURL are present', () => {
    process.env.OPENPENCIL_HUANXING_API_KEY = '  sk-owner  ';
    process.env.OPENPENCIL_HUANXING_BASE_URL = ' http://127.0.0.1:3000/v1 ';
    process.env.OPENPENCIL_HUANXING_MODEL = ' agnes-2.0-flash ';
    expect(readHuanxingDefaultCredentials()).toEqual({
      apiKey: 'sk-owner',
      baseURL: 'http://127.0.0.1:3000/v1',
      model: 'agnes-2.0-flash',
    });
  });
});

describe('requireHuanxingDefaultCredentials', () => {
  it('throws explicitly when not configured (zero fake)', () => {
    clearEnv();
    expect(() => requireHuanxingDefaultCredentials('m')).toThrow(/not configured/i);
  });

  it('prefers the requested model over the env default', () => {
    process.env.OPENPENCIL_HUANXING_API_KEY = 'sk-owner';
    process.env.OPENPENCIL_HUANXING_BASE_URL = 'http://127.0.0.1:3000/v1';
    process.env.OPENPENCIL_HUANXING_MODEL = 'env-model';
    expect(requireHuanxingDefaultCredentials('requested-model').model).toBe('requested-model');
  });

  it('falls back to the env default model when the requested model is empty', () => {
    process.env.OPENPENCIL_HUANXING_API_KEY = 'sk-owner';
    process.env.OPENPENCIL_HUANXING_BASE_URL = 'http://127.0.0.1:3000/v1';
    process.env.OPENPENCIL_HUANXING_MODEL = 'env-model';
    expect(requireHuanxingDefaultCredentials('  ').model).toBe('env-model');
  });

  it('throws when neither requested nor env model is set', () => {
    process.env.OPENPENCIL_HUANXING_API_KEY = 'sk-owner';
    process.env.OPENPENCIL_HUANXING_BASE_URL = 'http://127.0.0.1:3000/v1';
    expect(() => requireHuanxingDefaultCredentials('')).toThrow(/no model/i);
  });
});
