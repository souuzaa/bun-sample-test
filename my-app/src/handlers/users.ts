import type { RouteHandler } from "./types";
import { userRepository } from "../db/repositories/users";
import { cache } from "../cache/cache";
import {
  CACHE_KEYS,
  CACHE_CONFIG,
  invalidateUserCache,
} from "../cache/strategies";

export const getUsers: RouteHandler = async () => {
  try {
    // Check cache first
    const cacheKey = CACHE_KEYS.userList();
    const cachedUsers =
      await cache.get<Awaited<ReturnType<typeof userRepository.findAll>>>(
        cacheKey,
      );

    if (cachedUsers !== null) {
      return Response.json(cachedUsers);
    }

    // Cache miss - query DB
    const users = await userRepository.findAll();

    // Cache the result
    await cache.set(cacheKey, users, CACHE_CONFIG.userList);

    return Response.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    return Response.json({ error: "Failed to fetch users" }, { status: 500 });
  }
};

export const createUser: RouteHandler = async (req) => {
  try {
    const body = await req.json();

    if (!body.name || !body.email) {
      return Response.json(
        { error: "Name and email are required" },
        { status: 400 },
      );
    }

    const newUser = await userRepository.create({
      name: body.name,
      email: body.email,
    });

    // Invalidate user cache after creation
    await invalidateUserCache();

    return Response.json(newUser, { status: 201 });
  } catch (error) {
    console.error("Error creating user:", error);
    return Response.json({ error: "Failed to create user" }, { status: 500 });
  }
};

export const getUserById: RouteHandler = async (_req, params) => {
  try {
    const id = parseInt(params.id);

    if (isNaN(id)) {
      return Response.json({ error: "Invalid user ID" }, { status: 400 });
    }

    // Check cache first
    const cacheKey = CACHE_KEYS.userById(id);
    const cachedUser =
      await cache.get<Awaited<ReturnType<typeof userRepository.findById>>>(
        cacheKey,
      );

    if (cachedUser !== null) {
      return Response.json(cachedUser);
    }

    // Cache miss - query DB
    const user = await userRepository.findById(id);

    if (user) {
      // Cache the result
      await cache.set(cacheKey, user, CACHE_CONFIG.userById);
      return Response.json(user);
    }

    return Response.json({ error: "User not found" }, { status: 404 });
  } catch (error) {
    console.error("Error fetching user:", error);
    return Response.json({ error: "Failed to fetch user" }, { status: 500 });
  }
};

export const updateUser: RouteHandler = async (req, params) => {
  try {
    const id = parseInt(params.id);

    if (isNaN(id)) {
      return Response.json({ error: "Invalid user ID" }, { status: 400 });
    }

    // Get old user data for cache invalidation
    const oldUser = await userRepository.findById(id);

    if (!oldUser) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    const body = await req.json();

    const updatedUser = await userRepository.update(id, {
      name: body.name,
      email: body.email,
    });

    if (updatedUser) {
      // Invalidate user cache, including old email if it changed
      const oldEmail =
        body.email && body.email !== oldUser.email ? oldUser.email : undefined;
      await invalidateUserCache(id, oldEmail);

      return Response.json(updatedUser);
    }

    return Response.json({ error: "User not found" }, { status: 404 });
  } catch (error) {
    console.error("Error updating user:", error);
    return Response.json({ error: "Failed to update user" }, { status: 500 });
  }
};

export const deleteUser: RouteHandler = async (_req, params) => {
  try {
    const id = parseInt(params.id);

    if (isNaN(id)) {
      return Response.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const deleted = await userRepository.delete(id);

    if (deleted) {
      // Invalidate user cache after deletion
      await invalidateUserCache(id);

      return Response.json({ success: true });
    }

    return Response.json({ error: "User not found" }, { status: 404 });
  } catch (error) {
    console.error("Error deleting user:", error);
    return Response.json({ error: "Failed to delete user" }, { status: 500 });
  }
};
