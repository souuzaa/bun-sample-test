import type { RouteHandler } from "./types";

type User = {
  id: number;
  name: string;
  email: string;
};

const users: User[] = [
  { id: 1, name: "Alice", email: "alice@example.com" },
  { id: 2, name: "Bob", email: "bob@example.com" },
];

let nextId = 3;

export const getUsers: RouteHandler = () => Response.json(users);

export const createUser: RouteHandler = async (req) => {
  const body = await req.json();
  const newUser: User = {
    id: nextId++,
    name: body.name,
    email: body.email,
  };
  users.push(newUser);
  return Response.json(newUser, { status: 201 });
};

export const getUserById: RouteHandler = (_req, params) => {
  const user = users.find((u) => u.id === parseInt(params.id));
  if (user) {
    return Response.json(user);
  }
  return Response.json({ error: "User not found" }, { status: 404 });
};
