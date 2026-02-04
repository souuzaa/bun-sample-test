import { sql } from '../client';

export interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  name: string;
  email: string;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
}

export const userRepository = {
  /**
   * Find all users with pagination
   */
  async findAll(limit: number = 100, offset: number = 0): Promise<User[]> {
    return sql<User[]>`
      SELECT id, name, email, created_at, updated_at
      FROM users
      ORDER BY id
      LIMIT ${limit} OFFSET ${offset}
    `;
  },

  /**
   * Find a user by ID
   */
  async findById(id: number): Promise<User | null> {
    const [user] = await sql<User[]>`
      SELECT id, name, email, created_at, updated_at
      FROM users
      WHERE id = ${id}
    `;
    return user || null;
  },

  /**
   * Find a user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    const [user] = await sql<User[]>`
      SELECT id, name, email, created_at, updated_at
      FROM users
      WHERE email = ${email}
    `;
    return user || null;
  },

  /**
   * Create a new user
   */
  async create(input: CreateUserInput): Promise<User> {
    const [user] = await sql<User[]>`
      INSERT INTO users (name, email)
      VALUES (${input.name}, ${input.email})
      RETURNING id, name, email, created_at, updated_at
    `;
    return user;
  },

  /**
   * Update a user by ID
   */
  async update(id: number, input: UpdateUserInput): Promise<User | null> {
    const [user] = await sql<User[]>`
      UPDATE users
      SET
        name = COALESCE(${input.name ?? null}, name),
        email = COALESCE(${input.email ?? null}, email)
      WHERE id = ${id}
      RETURNING id, name, email, created_at, updated_at
    `;
    return user || null;
  },

  /**
   * Delete a user by ID
   */
  async delete(id: number): Promise<boolean> {
    const result = await sql`
      DELETE FROM users WHERE id = ${id}
    `;
    return result.count > 0;
  },

  /**
   * Create multiple users in a batch
   */
  async createBatch(users: CreateUserInput[]): Promise<User[]> {
    if (users.length === 0) {
      return [];
    }
    return sql<User[]>`
      INSERT INTO users ${sql(users, 'name', 'email')}
      RETURNING id, name, email, created_at, updated_at
    `;
  },
};
