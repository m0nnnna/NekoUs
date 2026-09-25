import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatrixError } from 'matrix-js-sdk';
import { registerAccount, RegistrationError } from './registration';

const register = vi.fn();

vi.mock('matrix-js-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('matrix-js-sdk')>();
  return { ...actual, createClient: () => ({ register }) };
});
vi.mock('./session', () => ({ setSession: vi.fn() }));

const TOKEN_STAGE = 'm.login.registration_token';

function uiaChallenge(extra: Record<string, unknown> = {}): MatrixError {
  return new MatrixError(
    { session: 'sess1', flows: [{ stages: [TOKEN_STAGE] }], params: {}, ...extra },
    401
  );
}

function prompts(tokens: (string | null)[]) {
  const enterRegistrationToken = vi.fn(async () => tokens.shift() ?? null);
  return {
    acceptTerms: vi.fn(),
    verifyEmail: vi.fn(),
    enterRegistrationToken,
  };
}

describe('registerAccount — registration token stage', () => {
  beforeEach(() => register.mockReset());

  it('sends the token the user entered and completes', async () => {
    register
      .mockRejectedValueOnce(uiaChallenge())
      .mockResolvedValueOnce({ user_id: '@a:x', device_id: 'D', access_token: 'T' });
    const p = prompts(['invite-123']);

    const session = await registerAccount('https://hs.example', 'a', 'password1', p);

    expect(session.userId).toBe('@a:x');
    expect(register).toHaveBeenLastCalledWith('a', 'password1', 'sess1', {
      type: TOKEN_STAGE,
      token: 'invite-123',
      session: 'sess1',
    });
    expect(p.enterRegistrationToken).toHaveBeenCalledWith(undefined);
  });

  it("re-asks with the server's error after a wrong token", async () => {
    register
      .mockRejectedValueOnce(uiaChallenge())
      .mockRejectedValueOnce(uiaChallenge({ errcode: 'M_FORBIDDEN', error: 'Invalid registration token' }))
      .mockResolvedValueOnce({ user_id: '@a:x', device_id: 'D', access_token: 'T' });
    const p = prompts(['wrong', 'right']);

    await registerAccount('https://hs.example', 'a', 'password1', p);

    expect(p.enterRegistrationToken).toHaveBeenNthCalledWith(2, 'Invalid registration token');
    expect(register.mock.calls[2][3]).toMatchObject({ token: 'right' });
  });

  it('gives up cleanly when the user cancels the token prompt', async () => {
    register.mockRejectedValueOnce(uiaChallenge());

    await expect(registerAccount('https://hs.example', 'a', 'password1', prompts([null]))).rejects.toBeInstanceOf(
      RegistrationError
    );
    expect(register).toHaveBeenCalledTimes(1);
  });
});
