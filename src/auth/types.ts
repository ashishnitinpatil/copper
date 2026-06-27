export type AuthProviderName = 'google' | 'apple';

export interface AuthIdentity {
  provider: AuthProviderName;
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

export interface GoogleSession {
  identity: AuthIdentity;
  accessToken: string;
  expiresAt: number;
  scopes: string[];
}

export interface AuthState {
  google: GoogleSession | null;
  apple: AuthIdentity | null;
}
