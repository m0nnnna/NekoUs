import { AuthType, createClient, MatrixError, type IAuthData, type MatrixClient } from 'matrix-js-sdk';
import { resolveHomeserverBaseUrl } from './login';
import { setSession, type Session } from './session';

export class RegistrationError extends Error {}

export type TermsPolicy = { name: string; url: string; version: string };
export type EmailVerification = { sid: string; clientSecret: string };

/** What the caller needs to resolve mid-registration when the server asks for it. */
export type RegistrationPrompts = {
  acceptTerms: (policies: TermsPolicy[]) => Promise<boolean>;
  /** Given the (still-unauthenticated) registration client, drive an email-verification UI and
   *  resolve once the address has actually been confirmed. */
  verifyEmail: (mx: MatrixClient) => Promise<EmailVerification>;
};

const SUPPORTED_STAGES = new Set<string>([AuthType.Dummy, AuthType.Terms, AuthType.Email]);

function extractTermsPolicies(params: Record<string, Record<string, unknown>> | undefined): TermsPolicy[] {
  const policies = params?.[AuthType.Terms]?.policies as
    | Record<string, Record<string, unknown> & { version: string }>
    | undefined;
  if (!policies) return [];

  return Object.values(policies).flatMap((policy) => {
    const lang = Object.entries(policy).find(([key]) => key !== 'version');
    if (!lang) return [];
    const [, info] = lang as [string, { name: string; url: string }];
    return [{ name: info.name, url: info.url, version: policy.version }];
  });
}

/**
 * Drives Matrix's User-Interactive Auth registration flow. Supports the common stages for a
 * self-hosted homeserver: `m.login.dummy` (nothing further needed), `m.login.terms` (accept a
 * ToS), and `m.login.email.identity` (verify an email address — homeserver-native, no separate
 * identity server assumed). Deliberately doesn't handle msisdn verification, recaptcha,
 * registration tokens, or SSO — a server requiring one of those for registration would need
 * reconfiguring to drop it for this to work.
 */
export async function registerAccount(
  server: string,
  username: string,
  password: string,
  prompts: RegistrationPrompts
): Promise<Session> {
  const baseUrl = await resolveHomeserverBaseUrl(server);
  const mx = createClient({ baseUrl });

  let sessionId: string | null = null;
  let auth: Record<string, unknown> | undefined;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const res = await mx.register(username, password, sessionId, auth as { session?: string; type: string });
      if (!res.access_token || !res.device_id) {
        throw new RegistrationError('Server did not return a session after registration.');
      }
      const session: Session = {
        baseUrl,
        userId: res.user_id,
        deviceId: res.device_id,
        accessToken: res.access_token,
      };
      setSession(session);
      return session;
    } catch (err) {
      if (!(err instanceof MatrixError) || err.httpStatus !== 401) {
        if (err instanceof RegistrationError) throw err;
        throw new RegistrationError(err instanceof Error ? err.message : 'Registration failed.');
      }

      const uia = err.data as IAuthData;
      sessionId = uia.session ?? sessionId;

      const completed = new Set(uia.completed ?? []);
      const flow = uia.flows?.find((f) => f.stages.every((stage) => SUPPORTED_STAGES.has(stage)));
      if (!flow) {
        const required = uia.flows?.[0]?.stages.join(', ') ?? 'additional verification';
        throw new RegistrationError(
          `This server requires ${required} to register, which NekoUs doesn't support yet — try adjusting your homeserver's registration settings.`
        );
      }

      const nextStage = flow.stages.find((stage) => !completed.has(stage));
      if (!nextStage) {
        throw new RegistrationError('Registration stalled — the server did not accept a known stage.');
      }

      if (nextStage === AuthType.Terms) {
        const accepted = await prompts.acceptTerms(extractTermsPolicies(uia.params));
        if (!accepted) {
          throw new RegistrationError('You need to accept the terms to create an account.');
        }
        auth = { type: nextStage, session: sessionId ?? undefined };
      } else if (nextStage === AuthType.Email) {
        const { sid, clientSecret } = await prompts.verifyEmail(mx);
        auth = {
          type: nextStage,
          session: sessionId ?? undefined,
          // Homeserver-native email verification (no delegated identity server) only needs
          // sid + client_secret — matrix-js-sdk's ThreepidCreds type marks id_server/
          // id_access_token as required, but those only apply to the delegated-IS case.
          threepid_creds: { sid, client_secret: clientSecret },
        };
      } else {
        auth = { type: nextStage, session: sessionId ?? undefined };
      }
    }
  }

  throw new RegistrationError('Registration did not complete after several attempts.');
}
