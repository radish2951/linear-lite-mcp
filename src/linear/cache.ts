/**
 * Simple in-memory cache for Linear API responses
 * Reduces redundant API calls for frequently accessed data
 */

interface CacheEntry<T> {
	data: T;
	expiresAt: number;
}

export class LinearCache {
	private cache = new Map<string, CacheEntry<unknown>>();
	private readonly defaultTTL = 5 * 60 * 1000; // 5 minutes

	/**
	 * Get cached data or fetch if not available/expired
	 */
	async getOrFetch<T>(
		key: string,
		fetcher: () => Promise<T>,
		ttl?: number,
	): Promise<T> {
		const entry = this.cache.get(key);
		const now = Date.now();

		// Return cached data if valid
		if (entry && entry.expiresAt > now) {
			return entry.data as T;
		}

		// Fetch fresh data
		const data = await fetcher();
		this.set(key, data, ttl);
		return data;
	}

	/**
	 * Set cached data
	 */
	set<T>(key: string, data: T, ttl?: number): void {
		const expiresAt = Date.now() + (ttl ?? this.defaultTTL);
		this.cache.set(key, { data, expiresAt });
	}

	/**
	 * Clear specific key or all cache
	 */
	clear(key?: string): void {
		if (key) {
			this.cache.delete(key);
		} else {
			this.cache.clear();
		}
	}

	/**
	 * Clean up expired entries
	 */
	cleanup(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache.entries()) {
			if (entry.expiresAt <= now) {
				this.cache.delete(key);
			}
		}
	}
}
