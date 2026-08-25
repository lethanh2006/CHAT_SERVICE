import type { Request } from "express";
import type { AuthenticatedUser } from "./authenticated-user.interface";

export interface RequestContext {
  requestId: string;
}

export interface RequestWithContext extends Request {
  requestContext?: RequestContext;
  user?: AuthenticatedUser;
}
