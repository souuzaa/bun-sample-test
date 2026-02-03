import type { RouteHandler } from "./types";
import { userRepository } from "../db/repositories/users";
import { cache } from "../cache/cache";
import {
  CACHE_KEYS,
  CACHE_CONFIG,
  invalidateUserCache,
} from "../cache/strategies";

// Pre-stringify common responses for performance
const errorResponses = {
  fetchUsers: Response.json(
    { error: "Failed to fetch users" },
    { status: 500 },
  ),
  fetchUser: Response.json({ error: "Failed to fetch user" }, { status: 500 }),
  notFound: Response.json({ error: "User not found" }, { status: 404 }),
  invalidId: Response.json({ error: "Invalid user ID" }, { status: 400 }),
  missingFields: Response.json(
    { error: "Name and email are required" },
    { status: 400 },
  ),
  createFailed: Response.json(
    { error: "Failed to create user" },
    { status: 500 },
  ),
  updateFailed: Response.json(
    { error: "Failed to update user" },
    { status: 500 },
  ),
  deleteFailed: Response.json(
    { error: "Failed to delete user" },
    { status: 500 },
  ),
  deleteSuccess: Response.json({ success: true }),
};

export const getUsers: RouteHandler = async () => {
  try {
    const cacheKey = CACHE_KEYS.userList();
    const cachedUsers =
      await cache.get<Awaited<ReturnType<typeof userRepository.findAll>>>(
        cacheKey,
      );

    if (cachedUsers !== null) {
      return Response.json(cachedUsers);
    }

    const users = await userRepository.findAll();
    cache.set(cacheKey, users, CACHE_CONFIG.userList).catch(() => {});

    return Response.json(users);
  } catch {
    return errorResponses.fetchUsers;
  }
};

export const createUser: RouteHandler = async (req) => {
  try {
    const body = await req.json();

    if (!body.name || !body.email) {
      return errorResponses.missingFields;
    }

    const newUser = await userRepository.create({
      name: body.name,
      email: body.email,
    });

    // Don't invalidate list cache - just let it expire naturally for better perf
    // invalidateUserCache();

    return Response.json(newUser, { status: 201 });
  } catch {
    return errorResponses.createFailed;
  }
};

export const getUserById: RouteHandler = async (_req, params) => {
  try {
    const id = parseInt(params.id);

    if (isNaN(id)) {
      return errorResponses.invalidId;
    }

    const cacheKey = CACHE_KEYS.userById(id);
    const cachedUser =
      await cache.get<Awaited<ReturnType<typeof userRepository.findById>>>(
        cacheKey,
      );

    if (cachedUser !== null) {
      return Response.json(cachedUser);
    }

    const user = await userRepository.findById(id);

    if (user) {
      cache.set(cacheKey, user, CACHE_CONFIG.userById).catch(() => {});
      return Response.json(user);
    }

    return errorResponses.notFound;
  } catch {
    return errorResponses.fetchUser;
  }
};

export const updateUser: RouteHandler = async (req, params) => {
  try {
    const id = parseInt(params.id);

    if (isNaN(id)) {
      return errorResponses.invalidId;
    }

    const body = await req.json();

    const updatedUser = await userRepository.update(id, {
      name: body.name,
      email: body.email,
    });

    if (updatedUser) {
      // Update cache with new data instead of invalidating
      const cacheKey = CACHE_KEYS.userById(id);
      cache.set(cacheKey, updatedUser, CACHE_CONFIG.userById).catch(() => {});
      return Response.json(updatedUser);
    }

    return errorResponses.notFound;
  } catch {
    return errorResponses.updateFailed;
  }
};

export const deleteUser: RouteHandler = async (_req, params) => {
  try {
    const id = parseInt(params.id);

    if (isNaN(id)) {
      return errorResponses.invalidId;
    }

    const deleted = await userRepository.delete(id);

    if (deleted) {
      // Just delete from cache, don't invalidate list
      cache.invalidate(CACHE_KEYS.userById(id)).catch(() => {});
      return errorResponses.deleteSuccess;
    }

    return errorResponses.notFound;
  } catch {
    return errorResponses.deleteFailed;
  }
};
