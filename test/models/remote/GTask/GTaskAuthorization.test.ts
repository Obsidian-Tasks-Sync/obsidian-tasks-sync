import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GTaskAuthorization } from '../../../../src/models/remote/GTask/GTaskAuthorization';
import { Platform } from 'obsidian';
import * as http from 'http';

// src/models/remote/GTask/GTaskAuthorization.test.ts

// Mocks
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => {
    const instance: any = {
      credentials: {},
      setCredentials: vi.fn((creds: any) => {
        instance.credentials = creds;
      }),
      getAccessToken: vi.fn(),
      getTokenInfo: vi.fn(),
      refreshAccessToken: vi.fn(),
      generateAuthUrl: vi.fn(),
      getToken: vi.fn(),
    };
    return instance;
  }),
}));

vi.mock('http', () => ({
  createServer: vi.fn(),
}));

vi.mock('src/models/PersistStorage', () => ({
  PersistStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(),
  })),
}));

describe('GTaskAuthorization', () => {
  let app: any;
  let auth: GTaskAuthorization;
  let oAuthInstance: any;

  beforeEach(() => {
    app = {};
    auth = new GTaskAuthorization(app, 'clientId', 'clientSecret');
    oAuthInstance = auth.getAuthClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
    (global as any).window = undefined;
  });

  it('getAuthClient returns the OAuth2Client instance', () => {
    expect(auth.getAuthClient()).toBe(oAuthInstance);
  });

  describe('init', () => {
    it('should preserve refresh_token when refreshAccessToken loses it', async () => {
      const savedTokens = {
        access_token: 'old-access',
        refresh_token: 'my-refresh-token',
        expiry_date: Date.now() - 10000,
      };
      const persistedCredentials = (auth as any).persistedCredentials;
      persistedCredentials.get.mockResolvedValue(savedTokens);

      // After refreshAccessToken, credentials lose refresh_token
      oAuthInstance.refreshAccessToken.mockImplementation(async () => {
        oAuthInstance.credentials = {
          access_token: 'new-access',
          // refresh_token is missing!
          expiry_date: Date.now() + 3600000,
        };
      });

      await auth.init();

      // Should restore refresh_token from saved tokens
      expect(oAuthInstance.credentials.refresh_token).toBe('my-refresh-token');
      // Should persist the restored credentials
      expect(persistedCredentials.set).toHaveBeenCalledWith(
        expect.objectContaining({ refresh_token: 'my-refresh-token' }),
      );
    });

    it('should not overwrite refresh_token if refreshAccessToken preserves it', async () => {
      const savedTokens = {
        access_token: 'old-access',
        refresh_token: 'my-refresh-token',
        expiry_date: Date.now() - 10000,
      };
      const persistedCredentials = (auth as any).persistedCredentials;
      persistedCredentials.get.mockResolvedValue(savedTokens);

      oAuthInstance.refreshAccessToken.mockImplementation(async () => {
        oAuthInstance.credentials = {
          access_token: 'new-access',
          refresh_token: 'my-refresh-token',
          expiry_date: Date.now() + 3600000,
        };
      });

      await auth.init();

      expect(oAuthInstance.credentials.refresh_token).toBe('my-refresh-token');
      expect(persistedCredentials.set).toHaveBeenCalled();
    });

    it('should not throw when refreshAccessToken fails', async () => {
      const savedTokens = {
        access_token: 'old-access',
        refresh_token: 'my-refresh-token',
        expiry_date: Date.now() - 10000,
      };
      const persistedCredentials = (auth as any).persistedCredentials;
      persistedCredentials.get.mockResolvedValue(savedTokens);

      oAuthInstance.refreshAccessToken.mockRejectedValue(new Error('Network error'));

      // Should not throw
      await expect(auth.init()).resolves.not.toThrow();
      // Should not persist (keeps saved credentials intact)
      expect(persistedCredentials.set).not.toHaveBeenCalled();
    });

    it('should do nothing when no saved tokens exist', async () => {
      const persistedCredentials = (auth as any).persistedCredentials;
      persistedCredentials.get.mockResolvedValue(null);

      await auth.init();

      expect(oAuthInstance.setCredentials).not.toHaveBeenCalled();
      expect(oAuthInstance.refreshAccessToken).not.toHaveBeenCalled();
      expect(persistedCredentials.set).not.toHaveBeenCalled();
    });
  });

  describe('ensureValidToken', () => {
    it('should call getAccessToken and persist refreshed credentials', async () => {
      oAuthInstance.getAccessToken.mockResolvedValue({ token: 'valid-token' });
      oAuthInstance.credentials = {
        access_token: 'valid-token',
        refresh_token: 'my-refresh',
        expiry_date: Date.now() + 3600000,
      };

      const persistedCredentials = (auth as any).persistedCredentials;

      await auth.ensureValidToken();

      expect(oAuthInstance.getAccessToken).toHaveBeenCalled();
      expect(persistedCredentials.set).toHaveBeenCalledWith(oAuthInstance.credentials);
    });

    it('should throw when getAccessToken returns null token', async () => {
      oAuthInstance.getAccessToken.mockResolvedValue({ token: null });

      await expect(auth.ensureValidToken()).rejects.toThrow('Token refresh failed. Please re-authorize in Settings.');
    });

    it('should throw when getAccessToken fails', async () => {
      oAuthInstance.getAccessToken.mockRejectedValue(new Error('No refresh token'));

      await expect(auth.ensureValidToken()).rejects.toThrow('Token refresh failed. Please re-authorize in Settings.');
    });
  });

  it('dispose closes the server if exists', () => {
    const close = vi.fn();
    (auth as any).server = { close };
    auth.dispose();
    expect(close).toHaveBeenCalled();
  });

  it('authorize returns access token if valid and not expired', async () => {
    oAuthInstance.getAccessToken.mockResolvedValue({ token: 'token123' });
    oAuthInstance.getTokenInfo.mockResolvedValue({ expiry_date: Date.now() + 10000 });
    const result = await auth.authorize();
    expect(result).toBe('token123');
  });

  it('authorize refreshes token if expired', async () => {
    oAuthInstance.getAccessToken.mockResolvedValue({ token: 'token123' });
    oAuthInstance.getTokenInfo.mockResolvedValue({ expiry_date: Date.now() - 10000 });
    oAuthInstance.refreshAccessToken.mockResolvedValue('refreshed');
    const result = await auth.authorize();
    expect(oAuthInstance.refreshAccessToken).toHaveBeenCalled();
    expect(result).toBe('refreshed');
  });

  it('authorize calls loginGoogle if error thrown', async () => {
    oAuthInstance.getAccessToken.mockRejectedValue(new Error('fail'));
    const spy = vi.spyOn(auth as any, 'loginGoogle').mockResolvedValue('login');
    const result = await auth.authorize();
    expect(spy).toHaveBeenCalled();
    expect(result).toBe('login');
  });

  it('loginGoogle opens browser and resolves on callback with code', async () => {
    oAuthInstance.generateAuthUrl.mockReturnValue('http://auth.url');
    oAuthInstance.getToken.mockResolvedValue({ tokens: { access_token: 'abc' } });

    (global as any).window = { open: vi.fn() };

    let serverCallback: any;
    (http.createServer as any).mockImplementation((cb: any) => {
      serverCallback = cb;
      return {
        listen: function (port: number, cb2: () => void) {
          cb2 && cb2();
          return this;
        },
        close: vi.fn(),
      };
    });

    const loginPromise = (auth as any).loginGoogle();

    // Simulate HTTP callback with code
    const req = { url: '/callback?code=thecode' };
    const res = { end: vi.fn() };
    await serverCallback(req, res);

    await expect(loginPromise).resolves.toBeUndefined();
    expect(oAuthInstance.getToken).toHaveBeenCalledWith('thecode');
    expect(oAuthInstance.setCredentials).toHaveBeenCalledWith({ access_token: 'abc' });
  });

  it('loginGoogle rejects if code is missing', async () => {
    (global as any).window = { open: vi.fn() };
    let serverCallback: any;
    (http.createServer as any).mockImplementation((cb: any) => {
      serverCallback = cb;
      return {
        listen: function (port: number, cb2: () => void) {
          cb2 && cb2();
          return this;
        },
        close: vi.fn(),
      };
    });

    const loginPromise = (auth as any).loginGoogle();

    // Simulate HTTP callback without code
    const req = { url: '/callback' };
    const res = { end: vi.fn() };
    await serverCallback(req, res);

    await expect(loginPromise).rejects.toThrow();
  });

  it('loginGoogle throws if not desktop', async () => {
    Platform.isDesktop = false;
    await expect((auth as any).loginGoogle()).rejects.toThrow('OAuth not supported on this device');
    Platform.isDesktop = true; // restore
  });
});
