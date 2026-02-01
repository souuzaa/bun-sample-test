import type { RouteHandler } from "./types";
import { home, health } from "./general";
import { getUsers, createUser, getUserById } from "./users";

export type { RouteHandler };

export const handlers: Record<string, RouteHandler> = {
  home,
  health,
  getUsers,
  createUser,
  getUserById,
};
