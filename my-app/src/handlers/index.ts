import type { RouteHandler } from "./types";
import { home, health } from "./general";
import {
  getUsers,
  createUser,
  getUserById,
  updateUser,
  deleteUser,
} from "./users";
import {
  hashWorkload,
  payloadWorkload,
  memoryWorkload,
  workloadStatus,
} from "./workload";

export type { RouteHandler };

export const handlers: Record<string, RouteHandler> = {
  // General
  home,
  health,
  // Users
  getUsers,
  createUser,
  getUserById,
  updateUser,
  deleteUser,
  // Workload simulation
  hashWorkload,
  payloadWorkload,
  memoryWorkload,
  workloadStatus,
};
