export function withTranslationCache(translate) {
    const cache = new Map();
    const maxEntries = 300;
    const ttlMs = 30 * 60 * 1000;

    return async function cachedTranslate(input) {
        const key = JSON.stringify([input.word, input.sentence]);
        const cached = cache.get(key);

        if (cached && cached.expiresAt > Date.now()) {
            return cached.promise;
        }

        cache.delete(key);

        const entry = {
            expiresAt: Infinity,
            promise: null
        };

        entry.promise = Promise.resolve()
            .then(() => translate(input))
            .then(
                result => {
                    entry.expiresAt = Date.now() + ttlMs;
                    return result;
                },
                error => {
                    if (cache.get(key) === entry) cache.delete(key);
                    throw error;
                }
            );
           
        cache.set(key, entry);
        
        if (cache.size > maxEntries) {
            cache.delete(cache.keys().next().value);
        }

        return entry.promise;
    };
}
