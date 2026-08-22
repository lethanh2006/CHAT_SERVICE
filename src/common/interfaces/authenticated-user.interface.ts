export interface AuthenticatedUser {
  _id: string;
  name?: string;
  username?: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
}
