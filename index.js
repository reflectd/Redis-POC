const express = require('express');
const path = require('path');
const redis = require('redis');
const crypto = require('crypto');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const MAX_REQUESTS_PER_MINUTE = 5;

// Connect to Redis (using Docker service name 'redis')
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = redis.createClient({ url:  redisUrl});
redisClient.on('error', (err) => console.log('Redis redisClient Error', err));

async function connectRedis() {
  await redisClient.connect();
}
connectRedis();

function expensiveHashing(data) {
  let hash = data;
  for (let i = 0; i < 10000000; i++) {
    hash = crypto.createHash('sha256').update(hash).digest('hex');
  }
  return hash;
}

app.post('/api', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const inputData = req.body.data;
    if (!inputData) {
      return res.status(400).json({ error: 'Missing data' });
    }

    // Rate limiting
    const rateLimitKey = `rate_limit:${apiKey}`;
    let currentCount = await redisClient.incr(rateLimitKey);
    if (currentCount === 1) {
      await redisClient.expire(rateLimitKey, 60);
    }
    if (currentCount > MAX_REQUESTS_PER_MINUTE) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    // Caching
    const cacheKey = 'cache:' + crypto.createHash('sha256').update(inputData).digest('hex');
    const cachedResult = await redisClient.get(cacheKey);
    if (cachedResult) {
      res.set('X-Cache', 'HIT');
      return res.json({ result: cachedResult });
    }

    // Expensive calculation
    const result = expensiveHashing(inputData);

    // Store in cache for 1 hour
    await redisClient.set(cacheKey, result, { EX: 3600 });

    res.set('X-Cache', 'MISS');
    return res.json({ result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(3000, () => {
  console.log('Server listening on port 3000');
});