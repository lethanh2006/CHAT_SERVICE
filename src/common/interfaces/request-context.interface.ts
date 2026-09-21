import type { Request } from 'express';

export interface AuthenticatedUser {
  _id: string;
  name?: string;
  username?: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
}

export interface RequestContext {
  requestId: string;
}

export interface RequestWithContext extends Request {
  requestContext?: RequestContext;
  user?: AuthenticatedUser;
}
