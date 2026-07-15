import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private memoryStore = new Map<string, { value: string; expiresAt: number | null }>();
  private useMemoryFallback = false;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  onModuleInit() {
    this.redis.on('connect', () => {
      this.logger.log('Connected to Redis');
      this.useMemoryFallback = false;
    });

    this.redis.on('error', (err) => {
      if (!this.useMemoryFallback) {
        this.logger.warn(`Redis unavailable (${err.message}). Using in-memory fallback cache.`);
        this.useMemoryFallback = true;
      }
    });
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  buildKey(tenantId: string | 'global', domain: string, key: string): string {
    return `erp:${tenantId}:${domain}:${key}`;
  }

  private cleanMemoryStore() {
    const now = Date.now();
    for (const [key, data] of this.memoryStore.entries()) {
      if (data.expiresAt && data.expiresAt < now) {
        this.memoryStore.delete(key);
      }
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (this.useMemoryFallback) {
      this.memoryStore.set(key, { value, expiresAt: null });
      return;
    }
    try {
      await this.redis.set(key, value);
    } catch (e) {
      this.useMemoryFallback = true;
      this.memoryStore.set(key, { value, expiresAt: null });
    }
  }

  async setWithTTL(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.useMemoryFallback) {
      this.memoryStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return;
    }
    try {
      await this.redis.setex(key, ttlSeconds, value);
    } catch (e) {
      this.useMemoryFallback = true;
      this.memoryStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.useMemoryFallback) {
      this.cleanMemoryStore();
      const data = this.memoryStore.get(key);
      return data ? data.value : null;
    }
    try {
      return await this.redis.get(key);
    } catch (e) {
      this.useMemoryFallback = true;
      this.cleanMemoryStore();
      const data = this.memoryStore.get(key);
      return data ? data.value : null;
    }
  }

  async del(key: string): Promise<void> {
    if (this.useMemoryFallback) {
      this.memoryStore.delete(key);
      return;
    }
    try {
      await this.redis.del(key);
    } catch (e) {
      this.useMemoryFallback = true;
      this.memoryStore.delete(key);
    }
  }

  async delByPattern(pattern: string): Promise<void> {
    if (this.useMemoryFallback) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      for (const key of this.memoryStore.keys()) {
        if (regex.test(key)) {
          this.memoryStore.delete(key);
        }
      }
      return;
    }
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (e) {
      this.useMemoryFallback = true;
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      for (const key of this.memoryStore.keys()) {
        if (regex.test(key)) {
          this.memoryStore.delete(key);
        }
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    if (this.useMemoryFallback) {
      this.cleanMemoryStore();
      return this.memoryStore.has(key);
    }
    try {
      const result = await this.redis.exists(key);
      return result > 0;
    } catch (e) {
      this.useMemoryFallback = true;
      this.cleanMemoryStore();
      return this.memoryStore.has(key);
    }
  }

  async increment(key: string): Promise<number> {
    if (this.useMemoryFallback) {
      this.cleanMemoryStore();
      const data = this.memoryStore.get(key);
      const val = data ? parseInt(data.value, 10) || 0 : 0;
      const newVal = val + 1;
      this.memoryStore.set(key, { value: newVal.toString(), expiresAt: data?.expiresAt || null });
      return newVal;
    }
    try {
      return await this.redis.incr(key);
    } catch (e) {
      this.useMemoryFallback = true;
      this.cleanMemoryStore();
      const data = this.memoryStore.get(key);
      const val = data ? parseInt(data.value, 10) || 0 : 0;
      const newVal = val + 1;
      this.memoryStore.set(key, { value: newVal.toString(), expiresAt: data?.expiresAt || null });
      return newVal;
    }
  }
}
